/**
 * VIGÍA HSE — Backend (Google Apps Script vinculado a la Sheet "Vigía HSE")
 * Señalética digital de seguridad para unidades mineras: charla de 5 minutos con asistencia por QR,
 * semáforo de tormenta eléctrica, alerta urgente, avisos con aprobación de HSE e indicadores.
 *
 * Web App (URL /exec):
 *   GET  ?area=GARITA          -> JSON con lo que debe mostrar esa pantalla
 *   GET  ?area=GARITA&ping=1   -> idem + anota la conexión en la hoja Estado
 *   GET  (sin área)            -> lista de áreas
 *   GET  ?charla=ID            -> datos de una charla (página de asistencia)
 *   POST {accion:'asistencia', charla, area, nombre, dni, tipo, empresa}
 *   POST {accion:'estado'|'semaforo'|'alerta', clave, ...}   (sala de control)
 *
 * Hojas (columnas y filas se buscan por nombre; el orden da lo mismo):
 *   Respuestas de formulario …  avisos publicados desde el Form (las crea setup)
 *   Áreas        Código · Nombre en pantalla
 *   Cinta        Texto · Áreas · Activo · Hasta (opcional)
 *   Indicadores  Indicador · Valor · Activo
 *   Control      etiqueta en la columna A y valor a la derecha
 *   Estado       última conexión de cada pantalla
 *   Bitácora     cambios del semáforo y de la alerta urgente (evidencia)
 *   Asistencia   registros de la charla por QR (evidencia)
 *
 * Publicar: desde apps-script/ con clasp (ver CLAUDE.md). Si se agregan hojas o columnas: menú Vigía HSE → Instalar / reparar.
 */

const VERSION = 'v1.4';
const APP = 'Vigía HSE';
const TZ = 'America/Lima';
const DEFAULT_DUR = 12;          // segundos por aviso
const CACHE_S = 60;              // segundos que se reutiliza la respuesta de un área
const PING_CADA_S = 120;         // cada cuánto se anota la conexión de un área en Estado
const CORREO_DEFECTO = 'mario@safetymind.ai';
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzCVG8fk5Skg7hQGiO_NB5dgpMxMiBMKJbR_oa-seOWnM7cp_VcJEqFmqk3ElNTW8yM/exec';
const BIENVENIDA_DEFECTO = 'Su seguridad y la de sus compañeros es lo primero.';
const ESTADOS = ['VERDE', 'AMARILLA', 'ROJA'];

const SHEET_AREAS    = 'Áreas';
const SHEET_CINTA    = 'Cinta';
const SHEET_IND      = 'Indicadores';
const SHEET_CONTROL  = 'Control';
const SHEET_STATUS   = 'Estado';
const SHEET_BITACORA = 'Bitácora';
const SHEET_ASIST    = 'Asistencia';

const CATEGORIAS = ['Charla de 5 minutos', 'Alerta de seguridad', 'Riesgos críticos', 'Campaña', 'Indicadores', 'Aviso general'];

// Preguntas del Form (se buscan sin importar tildes ni mayúsculas; "Archivo" por prefijo)
const Q = {
  titulo: 'Título', categoria: 'Categoría', archivo: 'Archivo', texto: 'Texto del aviso', link: 'Link para QR',
  cinta: 'Texto para la cinta', desde: 'Desde', hasta: 'Hasta', areas: 'Áreas', dur: 'Duración (segundos)',
  prio: 'Prioridad', autor: 'Publicado por'
};
// Columnas que agrega el script en la hoja de respuestas
const C = { url: 'URL', tipo: 'Tipo', id: 'ID', aprobado: 'Aprobado', activo: 'Activo' };

// Hoja Control: [clave buscada en la etiqueta, etiqueta, valor inicial, tipo]
const CONTROL = [
  ['nombre de la unidad', 'Nombre de la unidad minera', 'Unidad minera'],
  ['mensaje de bienvenida', 'Mensaje de bienvenida (al encender y cuando no hay avisos)', BIENVENIDA_DEFECTO],
  ['personal propio',  'Trabajadores laborando ahora: personal propio', ''],
  ['personal de contrata', 'Trabajadores laborando ahora: personal de contrata', ''],
  ['recargar',         '🔄 Recargar todas las pantallas (marca la casilla)', false, 'casilla'],
  ['semaforo',         'Semáforo de tormenta eléctrica', 'VERDE', 'semaforo'],
  ['alerta verde',     'Mensaje con alerta verde', 'Sin tormenta eléctrica cercana. Trabajos a la intemperie permitidos.'],
  ['alerta amarilla',  'Mensaje con alerta amarilla', 'Tormenta eléctrica a menos de 30 km. Prepárese para evacuar y ubique el refugio más cercano.'],
  ['alerta roja',      'Mensaje con alerta roja', 'Tormenta eléctrica a menos de 10 km. Suspenda todo trabajo a la intemperie y diríjase al refugio.'],
  ['alerta urgente',   'Alerta urgente para todas las pantallas (vacío = sin alerta)', ''],
  ['clave',            'Clave de la sala de control', ''],
  ['aprobacion',       'Los avisos del Form requieren aprobación de HSE (Sí/No)', 'Sí'],
  ['ultimo accidente', 'Fecha del último accidente incapacitante', ''],
  ['central',          'Central de emergencias de la unidad (anexo o canal de radio)', ''],
  ['latitud',          'Latitud (clima)', '-16.53'],
  ['longitud',         'Longitud (clima)', '-71.59'],
  ['correo',           'Correo para alertas', CORREO_DEFECTO],
  ['sin senal',        'Correo si una pantalla pasa estos minutos sin señal (No = no enviar)', 'No'],
  ['formulario',       'Link del formulario para publicar', '']
];

const AREAS_INICIALES = [['GARITA', 'Garita de ingreso'], ['COMEDOR', 'Comedor del campamento'], ['TALLER', 'Taller de mantenimiento']];
const CINTA_INICIAL = [
  ['Use siempre sus tres puntos de contacto al subir o bajar de un equipo', 'Todas', true, ''],
  ['Antes de intervenir un equipo: bloqueo y etiquetado, sin excepciones', 'TALLER', true, ''],
  ['Reporte todo incidente y acto inseguro a su supervisor', 'Todas', true, '']
];
const IND_INICIALES = [
  ['Índice de frecuencia (mes)', '0,00', true],
  ['Inspecciones planificadas cumplidas', '92 %', true]
];

/* ======================================================================
 * WEB APP
 * ==================================================================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.charla) return json_(charlaInfo_(String(p.charla)));
  if (p.aprobar) return aprobarPorLink_(String(p.aprobar), String(p.t || ''));
  const area = String(p.area || '').trim().toUpperCase();
  if (p.ping) logPing_(area);
  return ContentService.createTextOutput(respuesta_(area)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let b = {};
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Solicitud inválida.' }); }
  const acc = String(b.accion || '');
  if (acc === 'asistencia') return json_(conLock_(() => registrarAsistencia_(b)));
  if (['estado', 'semaforo', 'alerta', 'trabajadores', 'aprobar'].indexOf(acc) > -1) {
    const chk = claveOk_(b.clave);
    if (!chk.ok) return json_(chk);
    const quien = String(b.quien || '').trim().slice(0, 60);
    if (acc === 'semaforo') {
      const est = estado_(b.estado);
      if (ESTADOS.indexOf(String(b.estado || '').toUpperCase()) < 0) return json_({ ok: false, error: 'Estado de semáforo inválido.' });
      if (!quien) return json_({ ok: false, error: 'Escribe quién hace el cambio.' });
      conLock_(() => setSemaforo_(est, quien, 'Sala de control'));
    }
    if (acc === 'alerta') {
      if (!quien) return json_({ ok: false, error: 'Escribe quién hace el cambio.' });
      conLock_(() => setAlerta_(String(b.texto || '').trim().slice(0, 300), quien, 'Sala de control'));
    }
    if (acc === 'trabajadores') {
      const pr = numero_(b.propios), co = numero_(b.contratas);
      if ((b.propios !== '' && pr === null) || (b.contratas !== '' && co === null)) return json_({ ok: false, error: 'Escribe solo números de trabajadores.' });
      conLock_(() => setTrabajadores_(pr, co, quien || 'Sala de control'));
    }
    if (acc === 'aprobar') {
      if (!quien) return json_({ ok: false, error: 'Escribe quién aprueba.' });
      const r = conLock_(() => aprobarAviso_(String(b.id || ''), quien, 'Sala de control'));
      if (!r.ok) return json_(r);
    }
    return json_(estadoSala_());
  }
  return json_({ ok: false, error: 'Acción desconocida.' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** JSON de un área, reutilizado CACHE_S segundos (se borra al editar la Sheet, llegar un Form o cambiar el semáforo). */
function respuesta_(area) {
  const cache = CacheService.getScriptCache();
  const key = 'out_' + (area || '_');
  const hit = cache.get(key);
  if (hit) return hit;

  const areas = getListaAreas_();
  const info = areas.filter(a => a.codigo === area)[0] || null;
  const ctl = getControl_();
  const avisos = leerAvisos_();                                  // una sola lectura para avisos y cinta
  const out = info ? getPlaylist_(info, avisos) : { items: [], urgente: false };
  out.version     = VERSION;
  out.generado    = new Date().toISOString();
  out.area        = area;
  out.areaNombre  = info ? info.nombre : '';
  out.unidad      = ctl.unidad;
  out.listaAreas  = areas;
  out.cinta       = info ? getCinta_(info, avisos) : [];
  out.bienvenida  = ctl.bienvenida;
  out.trabajadores = ctl.trabajadores;
  out.indicadores = getIndicadores_(ctl);
  out.semaforo    = ctl.semaforo;
  out.alerta      = ctl.alerta;
  out.central     = ctl.central;
  out.clima       = ctl.clima;
  out.recarga     = ctl.recarga;

  const json = JSON.stringify(out);
  if (json.length < 90000) cache.put(key, json, CACHE_S);
  return json;
}

/** Borra la respuesta guardada de todas las áreas. */
function limpiarCache_() {
  const keys = { 'out__': 1 };
  try { getListaAreas_().forEach(a => { keys['out_' + a.codigo] = 1; }); } catch (e) {}
  CacheService.getScriptCache().removeAll(Object.keys(keys));
}

/* ---------------- Avisos del Form ---------------- */

/** Hoja de respuestas: la vinculada al Form (o la primera que se llame "Respuestas…"). */
function hojaAvisos_() {
  const sheets = SpreadsheetApp.getActive().getSheets();
  for (const s of sheets) { try { if (s.getFormUrl()) return s; } catch (e) {} }
  for (const s of sheets) if (/^(respuestas|form responses)/.test(norm_(s.getName()))) return s;
  return null;
}

/** Todas las filas de la hoja de respuestas (con encabezado), o [] si no hay. */
function leerAvisos_() {
  const sh = hojaAvisos_();
  return sh && sh.getLastRow() >= 2 ? sh.getDataRange().getValues() : [];
}

/** "10", "10 s", "12,5" → segundos (mínimo 3, máximo 600). Vacío o inválido → DEFAULT_DUR. */
function duracion_(v) {
  const n = parseFloat(String(v === null || v === undefined ? '' : v).replace(',', '.'));
  return isFinite(n) && n >= 3 ? Math.min(Math.round(n * 10) / 10, 600) : DEFAULT_DUR;
}

function getPlaylist_(area, avisos) {
  const data = avisos || leerAvisos_();
  if (data.length < 2) return { urgente: false, items: [] };
  const h = data[0];
  const col = name => colOf_(h, name);
  const ix = {
    titulo: col(Q.titulo), cat: col(Q.categoria), texto: col(Q.texto), link: col(Q.link),
    desde: col(Q.desde), hasta: col(Q.hasta), areas: col(Q.areas), dur: col(Q.dur), prio: col(Q.prio),
    url: col(C.url), tipo: col(C.tipo), id: col(C.id), aprobado: col(C.aprobado), activo: col(C.activo)
  };
  const val = (r, i) => (i > -1 ? String(r[i] === null || r[i] === undefined ? '' : r[i]).trim() : '');
  const now = Date.now();
  const items = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const url = val(r, ix.url);
    if (!url) continue;                                          // solo cinta, error o sin procesar
    if (ix.activo > -1 && isNo_(r[ix.activo])) continue;
    if (ix.aprobado > -1 && isNo_(r[ix.aprobado])) continue;     // pendiente de aprobación de HSE
    const ini = toDate_(r[ix.desde]);
    const fin = endOf_(toDate_(r[ix.hasta]));
    if (ini && now < ini.getTime()) continue;
    if (fin && now > fin.getTime()) continue;
    if (!matchArea_(ix.areas > -1 ? r[ix.areas] : 'Todas', area)) continue;

    const tipo = val(r, ix.tipo) || 'imagen';
    const cat = val(r, ix.cat);
    items.push({
      titulo:    val(r, ix.titulo),
      categoria: cat,
      url:       url,
      tipo:      tipo,
      texto:     tipo === 'texto' ? val(r, ix.texto) : '',
      dur:       ix.dur > -1 ? duracion_(r[ix.dur]) : DEFAULT_DUR,
      urgente:   /urgente/i.test(val(r, ix.prio)),
      link:      val(r, ix.link),
      charla:    /charla/i.test(cat) ? val(r, ix.id) : '',
      hasta:     fin ? fin.toISOString() : ''
    });
  }
  const urg = items.filter(x => x.urgente);
  return { urgente: urg.length > 0, items: urg.length ? urg : items };
}

/* ---------------- Cinta e indicadores ---------------- */

function cintaIdx_(sh) {
  const h = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(norm_);
  const f = t => h.findIndex(t) + 1;
  return {
    texto:  f(x => x.indexOf('texto') === 0) || 1,
    areas:  f(x => x.indexOf('area') === 0),
    activo: f(x => x === 'activo'),
    hasta:  f(x => x.indexOf('hasta') === 0)
  };
}

function getCinta_(area, avisos) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CINTA);
  if (!sh) return cintaForm_(area, avisos);
  const ix = cintaIdx_(sh);
  const last = lastTextRow_(sh, ix.texto);
  if (last < 2) return cintaForm_(area, avisos);
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const g = (r, c) => (c > 0 ? r[c - 1] : '');
  const now = Date.now();
  const out = [];
  rows.forEach(r => {
    const texto = String(g(r, ix.texto) || '').trim();
    if (!texto) return;
    if (ix.activo && isNo_(g(r, ix.activo))) return;
    const fin = endOf_(toDate_(g(r, ix.hasta)));
    if (fin && now > fin.getTime()) return;
    if (!matchArea_(g(r, ix.areas) || 'Todas', area)) return;
    out.push({ es: texto });
  });
  return out.concat(cintaForm_(area, avisos));
}

/** "Texto para la cinta" del Form: se lee desde las respuestas para que también espere la aprobación de HSE. */
function cintaForm_(area, avisos) {
  const data = avisos || leerAvisos_();
  if (data.length < 2) return [];
  const h = data[0];
  const ix = { cinta: colOf_(h, Q.cinta), desde: colOf_(h, Q.desde), hasta: colOf_(h, Q.hasta), areas: colOf_(h, Q.areas),
               aprobado: colOf_(h, C.aprobado), activo: colOf_(h, C.activo) };
  if (ix.cinta < 0) return [];
  const now = Date.now();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const texto = String(r[ix.cinta] || '').trim();
    if (!texto) continue;
    if (ix.activo > -1 && isNo_(r[ix.activo])) continue;
    if (ix.aprobado > -1 && isNo_(r[ix.aprobado])) continue;
    const ini = ix.desde > -1 ? toDate_(r[ix.desde]) : null;
    const fin = ix.hasta > -1 ? endOf_(toDate_(r[ix.hasta])) : null;
    if (ini && now < ini.getTime()) continue;
    if (fin && now > fin.getTime()) continue;
    if (!matchArea_(ix.areas > -1 ? r[ix.areas] : 'Todas', area)) continue;
    out.push({ es: texto });
  }
  return out;
}

/** Indicadores de la hoja + días sin accidentes incapacitantes (Control). */
function getIndicadores_(ctl) {
  const out = [];
  if (ctl.ultimoAccidente) {
    const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    const ult = Utilities.formatDate(ctl.ultimoAccidente, TZ, 'yyyy-MM-dd');
    const dias = Math.round((Date.parse(hoy) - Date.parse(ult)) / 86400000);
    if (dias >= 0) out.push({ nombre: 'Días sin accidentes incapacitantes', valor: String(dias), destacado: true });
  }
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_IND);
  if (!sh || sh.getLastRow() < 2) return out;
  const d = sh.getDataRange().getDisplayValues();
  const h = d[0].map(norm_);
  const cN = Math.max(h.findIndex(x => x.indexOf('indicador') === 0), 0);
  const cV = h.findIndex(x => x.indexOf('valor') === 0);
  const cA = h.findIndex(x => x === 'activo');
  d.slice(1).forEach(r => {
    const n = String(r[cN] || '').trim(), v = cV > -1 ? String(r[cV] || '').trim() : '';
    if (!n || !v) return;
    if (cA > -1 && isNo_(r[cA])) return;                          // casilla desmarcada se lee "FALSE"
    out.push({ nombre: n, valor: v });
  });
  return out;
}

/* ---------------- Control ---------------- */

/** Fila de Control cuya etiqueta (columna A) contiene "clave" → número de fila (0 si no está). */
function filaControl_(sh, clave) {
  const n = sh.getLastRow();
  if (n < 1) return 0;
  const a = sh.getRange(1, 1, n, 1).getValues();
  for (let i = 0; i < a.length; i++) if (norm_(a[i][0]).indexOf(clave) > -1) return i + 1;
  return 0;
}
function celdaControl_(sh, clave) { const r = filaControl_(sh, clave); return r ? sh.getRange(r, 2) : null; }
function valorControl_(sh, clave) { const c = celdaControl_(sh, clave); return c ? c.getValue() : ''; }
function textoControl_(sh, clave) {
  const c = celdaControl_(sh, clave);
  return c ? String(c.getDisplayValues()[0][0] || '').trim() : '';
}

function estado_(v) {
  const t = norm_(v);
  if (/roj/.test(t)) return 'ROJA';
  if (/amar|ambar/.test(t)) return 'AMARILLA';
  return 'VERDE';
}

/** Control leído de una vez: [{k: etiqueta normalizada, v: valor, t: texto visible}]. */
function controlMapa_(sh) {
  if (!sh || sh.getLastRow() < 1) return [];
  const rg = sh.getRange(1, 1, sh.getLastRow(), 2);
  const v = rg.getValues(), d = rg.getDisplayValues();
  return v.map((r, i) => ({ k: norm_(r[0]), v: r[1], t: String(d[i][1] || '').trim() }));
}
function deMapa_(m, clave) { for (const x of m) if (x.k.indexOf(clave) > -1) return x; return { v: '', t: '' }; }

/** "1.248", "1248", "1 248" → 1248. Vacío o sin dígitos → null. */
function numero_(v) {
  const t = String(v === null || v === undefined ? '' : v).replace(/[\s.,]/g, '');
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

function getControl_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL);
  const pr = PropertiesService.getScriptProperties();
  const recarga = pr.getProperty('recarga') || '1';
  const m = controlMapa_(sh);
  const t = k => deMapa_(m, k).t;
  const est = estado_(t('semaforo'));
  const alerta = t('alerta urgente');
  const fecha = deMapa_(m, 'ultimo accidente').v;
  const propios = numero_(t('personal propio')), contratas = numero_(t('personal de contrata'));
  const lat = parseFloat(t('latitud').replace(',', '.')), lon = parseFloat(t('longitud').replace(',', '.'));
  return {
    recarga: recarga,
    unidad: t('nombre de la unidad'),
    semaforo: {
      estado: est,
      mensaje: t('alerta ' + est.toLowerCase()),
      desde: pr.getProperty('semaforoDesde') || ''
    },
    alerta: alerta ? { texto: alerta, desde: pr.getProperty('alertaDesde') || '' } : null,
    central: t('central'),
    bienvenida: t('mensaje de bienvenida') || BIENVENIDA_DEFECTO,
    trabajadores: propios === null && contratas === null ? null : {
      total: (propios || 0) + (contratas || 0), propios: propios, contratas: contratas,
      desde: pr.getProperty('trabajadoresDesde') || ''
    },
    ultimoAccidente: fecha instanceof Date ? fecha : toDate_(fecha),
    clima: isFinite(lat) && isFinite(lon) ? { lat: lat, lon: lon } : null
  };
}

function correoAlertas_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL);
  const v = sh ? textoControl_(sh, 'correo') : '';
  return /@/.test(v) ? v : CORREO_DEFECTO;
}

function alertar_(asunto, cuerpo) {
  try {
    MailApp.sendEmail(correoAlertas_(), '[' + APP + '] ' + asunto, cuerpo);
  } catch (e) {
    console.error('No se pudo enviar la alerta: ' + e);
  }
}

/* ---------------- Semáforo y alerta urgente ---------------- */

function setSemaforo_(estado, quien, origen) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL) || prepararControl_();
  const c = celdaControl_(sh, 'semaforo');
  if (c) c.setValue(estado);
  semaforoCambiado_(estado, quien, origen);
}

function semaforoCambiado_(estado, quien, origen) {
  PropertiesService.getScriptProperties().setProperty('semaforoDesde', new Date().toISOString());
  registrar_('Semáforo', estado, quien, origen);
  limpiarCache_();
}

function setAlerta_(texto, quien, origen) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL) || prepararControl_();
  const c = celdaControl_(sh, 'alerta urgente');
  if (c) c.setValue(texto);
  alertaCambiada_(texto, quien, origen);
}

function alertaCambiada_(texto, quien, origen) {
  PropertiesService.getScriptProperties().setProperty('alertaDesde', new Date().toISOString());
  registrar_('Alerta urgente', texto || '(quitada)', quien, origen);
  limpiarCache_();
}

/** Bitácora: Fecha y hora · Evento · Valor · Quién · Origen (evidencia de cada cambio). */
function registrar_(evento, valor, quien, origen) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_BITACORA) || prepararBitacora_();
  sh.appendRow([new Date(), evento, valor, quien || '', origen || '']);
}

function usuario_() {
  try { return Session.getActiveUser().getEmail() || 'Planilla'; } catch (e) { return 'Planilla'; }
}

function semaforoVerde()    { setSemaforo_('VERDE', usuario_(), 'Menú de la planilla');    toast_('Semáforo VERDE enviado a las pantallas.'); }
function semaforoAmarilla() { setSemaforo_('AMARILLA', usuario_(), 'Menú de la planilla'); toast_('Semáforo AMARILLA enviado a las pantallas.'); }
function semaforoRoja()     { setSemaforo_('ROJA', usuario_(), 'Menú de la planilla');     toast_('Semáforo ROJA enviado a las pantallas.'); }
function toast_(m) { try { SpreadsheetApp.getActive().toast(m, APP, 8); } catch (e) {} }

/* ---------------- Trabajadores laborando ---------------- */

function setTrabajadores_(propios, contratas, quien) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL) || prepararControl_();
  const a = celdaControl_(sh, 'personal propio'), b = celdaControl_(sh, 'personal de contrata');
  if (a) a.setValue(propios === null ? '' : propios);
  if (b) b.setValue(contratas === null ? '' : contratas);
  PropertiesService.getScriptProperties().setProperty('trabajadoresDesde', new Date().toISOString());
  registrar_('Trabajadores laborando', 'Propios ' + (propios === null ? '—' : propios) + ' · Contratas ' + (contratas === null ? '—' : contratas), quien, 'Sala de control');
  limpiarCache_();
}

/* ---------------- Aprobación de avisos ---------------- */

function secreto_() {
  const pr = PropertiesService.getScriptProperties();
  let s = pr.getProperty('secreto');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); pr.setProperty('secreto', s); }
  return s;
}
function token_(id) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(id), secreto_())).slice(0, 22);
}
function linkAprobar_(id) { return WEBAPP_URL + '?aprobar=' + encodeURIComponent(id) + '&t=' + token_(id); }

/** Marca "Aprobado" en el aviso con ese ID y lo deja en la bitácora. */
function aprobarAviso_(id, quien, origen) {
  const sh = hojaAvisos_();
  if (!id || !sh || sh.getLastRow() < 2) return { ok: false, error: 'No encontramos ese aviso.' };
  const data = sh.getDataRange().getValues();
  const h = data[0], cId = colOf_(h, C.id), cAp = colOf_(h, C.aprobado), cT = colOf_(h, Q.titulo);
  if (cId < 0 || cAp < 0) return { ok: false, error: 'La hoja de respuestas no tiene las columnas ID y Aprobado: corre Instalar / reparar.' };
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cId]).trim() !== id) continue;
    const titulo = cT > -1 ? String(data[i][cT] || '') : '';
    if (data[i][cAp] === true) return { ok: true, ya: true, titulo: titulo };
    sh.getRange(i + 1, cAp + 1).setValue(true);
    registrar_('Aviso aprobado', titulo, quien, origen);
    limpiarCache_();
    return { ok: true, titulo: titulo };
  }
  return { ok: false, error: 'No encontramos ese aviso.' };
}

/** Link "Aprobar" del correo: aprueba con un toque desde el celular. */
function aprobarPorLink_(id, t) {
  let titulo = 'Aviso', msg;
  if (!t || t !== token_(id)) msg = 'Este link de aprobación no es válido.';
  else {
    const r = conLock_(() => aprobarAviso_(id, 'Link del correo', 'Correo'));
    titulo = r.titulo || titulo;
    msg = !r.ok ? r.error : r.ya ? 'Este aviso ya estaba aprobado.' : 'Aprobado. Aparece en las pantallas en menos de 30 segundos.';
  }
  const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return HtmlService.createHtmlOutput(
    '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;color:#0F1B33">' +
    '<div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#2563EB;font-weight:700">' + APP + '</div>' +
    '<h1 style="font-size:26px;margin:8px 0 12px">' + esc(titulo) + '</h1><p style="font-size:18px">' + esc(msg) + '</p></div>')
    .setTitle(APP + ' · Aprobación').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Avisos esperando aprobación (vigentes o futuros), para la sala de control. */
function pendientes_() {
  const data = leerAvisos_();
  if (data.length < 2) return [];
  const h = data[0], c = n => colOf_(h, n);
  const ix = { id: c(C.id), ap: c(C.aprobado), ac: c(C.activo), url: c(C.url), cinta: c(Q.cinta), t: c(Q.titulo),
               cat: c(Q.categoria), autor: c(Q.autor), areas: c(Q.areas), hasta: c(Q.hasta) };
  if (ix.id < 0 || ix.ap < 0) return [];
  const now = Date.now();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i], g = k => (ix[k] > -1 ? String(r[ix[k]] === null ? '' : r[ix[k]]).trim() : '');
    if (!isNo_(r[ix.ap]) || (ix.ac > -1 && isNo_(r[ix.ac]))) continue;
    if (!g('url') && !g('cinta')) continue;
    const fin = ix.hasta > -1 ? endOf_(toDate_(r[ix.hasta])) : null;
    if (fin && now > fin.getTime()) continue;
    out.push({ id: g('id'), titulo: g('t') || g('cinta').slice(0, 60), categoria: g('cat'), autor: g('autor'), areas: g('areas') });
  }
  return out;
}

/* ---------------- Sala de control ---------------- */

/** Clave de la sala de control, con bloqueo de 10 min tras 10 intentos fallidos. */
function claveOk_(clave) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('claveFallos') || 0);
  if (fallos >= 10) return { ok: false, error: 'Demasiados intentos fallidos. Espera 10 minutos.' };
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL);
  const real = sh ? textoControl_(sh, 'clave') : '';
  if (!real) return { ok: false, error: 'Falta definir la clave en la hoja Control.' };
  if (String(clave || '').trim() !== real) {
    cache.put('claveFallos', String(fallos + 1), 600);
    return { ok: false, error: 'Clave incorrecta.' };
  }
  return { ok: true };
}

function estadoSala_() {
  const ctl = getControl_();
  const ss = SpreadsheetApp.getActive();
  const b = ss.getSheetByName(SHEET_BITACORA);
  let bitacora = [];
  if (b && b.getLastRow() > 1) {
    const n = Math.min(15, b.getLastRow() - 1);
    bitacora = b.getRange(b.getLastRow() - n + 1, 1, n, 5).getValues().reverse().map(r => ({
      fecha: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), evento: String(r[1]), valor: String(r[2]),
      quien: String(r[3]), origen: String(r[4])
    }));
  }
  return { ok: true, version: VERSION, unidad: ctl.unidad, semaforo: ctl.semaforo, alerta: ctl.alerta,
           trabajadores: ctl.trabajadores, pendientes: pendientes_(), bitacora: bitacora, pantallas: pantallas_() };
}

/** Última conexión de cada área de la hoja Áreas (null = nunca se conectó). */
function pantallas_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_STATUS);
  const vistos = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {   // Área · Nombre · Última conexión
      if (r[2] instanceof Date) vistos[String(r[0]).trim().toUpperCase()] = r[2];
    });
  }
  return getListaAreas_().map(a => {
    const d = vistos[a.codigo];
    return { codigo: a.codigo, nombre: a.nombre, ultima: d ? d.toISOString() : '',
             minutos: d ? Math.round((Date.now() - d.getTime()) / 60000) : null };
  });
}

/* ---------------- Asistencia por QR ---------------- */

function filaCharla_(id) {
  const sh = hojaAvisos_();
  if (!id || !sh || sh.getLastRow() < 2) return null;
  const data = sh.getDataRange().getValues();
  const h = data[0];
  const cId = colOf_(h, C.id);
  if (cId < 0) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cId]).trim() === id) {
      const g = n => { const c = colOf_(h, n); return c > -1 ? data[i][c] : ''; };
      return { titulo: String(g(Q.titulo) || '').trim(), desde: toDate_(g(Q.desde)), hasta: endOf_(toDate_(g(Q.hasta))),
               activo: !isNo_(g(C.activo)), aprobado: colOf_(h, C.aprobado) < 0 || !isNo_(g(C.aprobado)) };
    }
  }
  return null;
}

function charlaInfo_(id) {
  const f = filaCharla_(String(id).trim());
  if (!f) return { ok: false, error: 'No encontramos esta charla. Vuelve a escanear el QR de la pantalla.' };
  const now = Date.now();
  const vigente = f.activo && f.aprobado && !(f.desde && now < f.desde.getTime()) && !(f.hasta && now > f.hasta.getTime());
  return { ok: true, titulo: f.titulo, vigente: vigente, unidad: getControl_().unidad,
           error: vigente ? '' : 'Esta charla ya no está vigente: el registro está cerrado.' };
}

function registrarAsistencia_(b) {
  const id = String(b.charla || '').trim();
  const info = charlaInfo_(id);
  if (!info.ok || !info.vigente) return { ok: false, error: info.error };
  const nombre = String(b.nombre || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const dni = String(b.dni || '').replace(/[\s.-]/g, '').toUpperCase();
  const tipo = /contrat/i.test(b.tipo || '') ? 'Contrata' : 'Propio';
  const empresa = String(b.empresa || '').trim().slice(0, 80);
  if (nombre.length < 5 || nombre.indexOf(' ') < 0) return { ok: false, error: 'Escribe tu nombre y apellido.' };
  if (!/^[A-Z0-9]{8,12}$/.test(dni)) return { ok: false, error: 'El DNI o carné de extranjería no es válido (8 a 12 caracteres).' };
  if (tipo === 'Contrata' && empresa.length < 2) return { ok: false, error: 'Escribe el nombre de tu empresa contratista.' };
  const areas = getListaAreas_();
  const codArea = String(b.area || '').trim().toUpperCase();
  const area = areas.filter(a => a.codigo === codArea)[0];

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_ASIST) || prepararAsistencia_();
  if (sh.getLastRow() > 1) {
    const prev = sh.getRange(2, 2, sh.getLastRow() - 1, 5).getValues();   // ID · Charla · Área · Nombre · DNI
    if (prev.some(r => String(r[0]) === id && String(r[4]).toUpperCase() === dni)) {
      return { ok: true, repetido: true, titulo: info.titulo, mensaje: 'Ya estabas registrado en esta charla.' };
    }
  }
  const ahora = new Date();
  sh.appendRow([ahora, id, info.titulo, area ? area.nombre : codArea, nombre, dni, tipo, tipo === 'Contrata' ? empresa : '']);
  sh.getRange(sh.getLastRow(), 6).setNumberFormat('@').setValue(dni);   // conserva ceros a la izquierda
  return { ok: true, titulo: info.titulo, hora: Utilities.formatDate(ahora, TZ, 'HH:mm'),
           mensaje: 'Asistencia registrada.' };
}

/* ---------------- Áreas ---------------- */

function getListaAreas_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_AREAS);
  if (!sh || sh.getLastRow() < 2) return [];
  const d = sh.getDataRange().getValues();
  const h = d[0].map(norm_);
  const cCod = Math.max(h.findIndex(x => x.indexOf('codigo') === 0), 0);
  let cNom = h.findIndex(x => x.indexOf('nombre') === 0);
  if (cNom < 0) cNom = cCod === 0 ? 1 : 0;
  return d.slice(1)
    .filter(r => String(r[cCod]).trim())
    .map(r => ({ codigo: String(r[cCod]).trim().toUpperCase(), nombre: String(r[cNom] || r[cCod]).trim() }));
}

/** "Todas", códigos o nombres separados por coma (como los entrega el Form). */
function matchArea_(valor, area) {
  const t = String(valor || 'Todas');
  if (/todas/i.test(t)) return true;
  if (!area) return false;
  const cod = norm_(area.codigo), nom = norm_(area.nombre);
  return t.split(',').map(norm_).some(p => p && (p === cod || p === nom));
}

/* ======================================================================
 * FORM
 * ==================================================================== */

function onFormSubmit(e) {
  try {
    procesarForm_(e);
  } catch (err) {
    alertar_('Error al procesar un aviso del Form',
      'El aviso de la fila ' + (e && e.range ? e.range.getRow() : '?') + ' no se pudo procesar:\n\n' + err);
    throw err;
  } finally {
    limpiarCache_();
  }
}

function procesarForm_(e) {
  const sh = e.range.getSheet();
  const row = e.range.getRow();
  const nv = e.namedValues || {};
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const fila = sh.getRange(row, 1, 1, h.length).getValues()[0];
  const celda = name => { const c = colOf_(h, name); return c > -1 ? fila[c] : ''; };
  const titulo = answer_(nv, Q.titulo);
  const texto  = answer_(nv, Q.texto);
  const cinta  = answer_(nv, Q.cinta);
  const areas  = answer_(nv, Q.areas) || 'Todas';
  const id     = driveId_(answerPrefix_(nv, 'archivo').split(',')[0].trim());

  const setCol = (name, v) => sh.getRange(row, ensureCol_(sh, name)).setValue(v);
  const idAviso = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  setCol(C.id, idAviso);
  sh.getRange(row, ensureCol_(sh, C.activo)).insertCheckboxes().setValue(true);
  const requiere = isYes_(textoControl_(SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL) || prepararControl_(), 'aprobacion'));
  sh.getRange(row, ensureCol_(sh, C.aprobado)).insertCheckboxes().setValue(!requiere);

  let resultado = '';
  if (id) {
    try {
      const file = DriveApp.getFileById(id);
      const mime = String(file.getMimeType() || '');
      const tipo = mime.indexOf('video') === 0 ? 'video' : mime.indexOf('image') === 0 ? 'imagen' : '';
      if (!tipo) throw new Error('el archivo es de tipo "' + mime + '"; solo sirven imágenes (JPG, PNG) o videos (MP4)');
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      setCol(C.url, directUrl_(id, tipo));
      setCol(C.tipo, tipo);
      resultado = tipo;
    } catch (err) {
      const msg = String(err && err.message || err);
      setCol(C.tipo, 'ERROR: ' + msg);
      alertar_('El aviso "' + (titulo || 'sin título') + '" no salió en pantalla',
        'No se pudo usar el archivo del aviso "' + (titulo || 'sin título') + '":\n\n' + msg +
        '\n\nFila ' + row + ' de la hoja "' + sh.getName() + '". Publica de nuevo con una imagen JPG/PNG ' +
        '(1920×850 px) o un video MP4.');
      return;
    }
  } else if (texto || (titulo && !cinta)) {
    setCol(C.url, 'texto');
    setCol(C.tipo, 'texto');
    resultado = 'texto';
  } else {
    setCol(C.tipo, 'solo cinta');
  }
  if (cinta && !resultado) resultado = 'cinta';      // el texto de la cinta también espera la aprobación

  if (requiere && resultado) {
    alertar_('Aviso pendiente de aprobación: ' + (titulo || 'sin título'),
      (answer_(nv, Q.autor) || 'Alguien') + ' publicó "' + (titulo || 'sin título') + '" para ' + areas + '.\n\n' +
      'Aprobar con un toque (sale en pantalla en menos de 30 segundos):\n' + linkAprobar_(idAviso) +
      '\n\nO marca la casilla "Aprobado" en la fila ' + row + ' de la hoja "' + sh.getName() + '":\n' +
      SpreadsheetApp.getActive().getUrl());
  }
}

/* ======================================================================
 * EDICIONES EN LA SHEET (disparador instalable)
 * ==================================================================== */

function alEditar(e) {
  if (!e || !e.range) return;
  limpiarCache_();
  const sh = e.range.getSheet();
  const name = sh.getName();
  const r0 = e.range.getRow(), c0 = e.range.getColumn();
  const r1 = e.range.getLastRow(), c1 = e.range.getLastColumn();

  if (name === SHEET_CONTROL) {
    if (c0 > 2 || c1 < 2) return;
    const cb = celdaControl_(sh, 'recargar');
    if (cb && cb.getValue() === true) { recargarPantallas(); cb.setValue(false); }
    for (let r = r0; r <= r1; r++) {
      const etq = norm_(sh.getRange(r, 1).getValue());
      if (etq.indexOf('semaforo') > -1) {
        const est = estado_(sh.getRange(r, 2).getValue());
        sh.getRange(r, 2).setValue(est);
        semaforoCambiado_(est, usuario_(), 'Planilla');
      } else if (etq.indexOf('alerta urgente') > -1) {
        alertaCambiada_(String(sh.getRange(r, 2).getValue() || '').trim(), usuario_(), 'Planilla');
      } else if (etq.indexOf('trabajadores laborando') > -1) {
        PropertiesService.getScriptProperties().setProperty('trabajadoresDesde', new Date().toISOString());
      }
    }
    return;
  }

  if (name === SHEET_AREAS) { actualizarAreasForm_(); return; }

  if (name === SHEET_CINTA && r1 >= 2) {
    const ix = cintaIdx_(sh);
    if (c0 > ix.texto || c1 < ix.texto) return;
    for (let row = Math.max(r0, 2); row <= r1; row++) {
      if (!String(sh.getRange(row, ix.texto).getValue()).trim()) continue;
      if (ix.areas && String(sh.getRange(row, ix.areas).getValue()).trim()) continue;
      if (ix.areas) sh.getRange(row, ix.areas).setValue('Todas');
      if (ix.activo) sh.getRange(row, ix.activo).insertCheckboxes().setValue(true);
    }
  }
}

function recargarPantallas() {
  PropertiesService.getScriptProperties().setProperty('recarga', String(Date.now()));
  limpiarCache_();
  toast_('Recarga enviada: las pantallas se actualizan en menos de 1 minuto.');
}

/* ======================================================================
 * MONITOREO
 * ==================================================================== */

function logPing_(area) {
  if (!area) return;
  const cache = CacheService.getScriptCache();
  if (cache.get('ping_' + area)) return;
  const info = getListaAreas_().filter(a => a.codigo === area)[0];
  if (!info) return;                                             // áreas inventadas no se anotan
  cache.put('ping_' + area, '1', PING_CADA_S);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(SHEET_STATUS) || prepararEstado_();
    const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => String(r[0]).toUpperCase());
    const r = ids.indexOf(area) + 1;
    if (r > 0) {
      sh.getRange(r, 3).setValue(new Date());
    } else {
      sh.appendRow([area, info.nombre, new Date()]);
      const nr = sh.getLastRow();
      sh.getRange(nr, 4).setFormula('=ROUND((NOW()-C' + nr + ')*1440)');
    }
  } finally {
    lock.releaseLock();
  }
}

/** Disparador cada 10 min: correo cuando una pantalla se cae o vuelve. */
function revisarPantallas() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CONTROL);
  const lim = Number(sh ? textoControl_(sh, 'sin senal') : '');
  const pr = PropertiesService.getScriptProperties();
  if (!(lim > 0)) { pr.setProperty('caidas', '{}'); return; }   // correo desactivado en Control ("No" o vacío)
  let caidas = {};
  try { caidas = JSON.parse(pr.getProperty('caidas') || '{}'); } catch (e) {}
  const nuevas = [], vueltas = [];
  pantallas_().forEach(p => {
    if (p.minutos === null) return;                              // nunca conectada: no se alerta
    if (p.minutos > lim && !caidas[p.codigo]) { caidas[p.codigo] = 1; nuevas.push(p.nombre + ' (' + p.minutos + ' min)'); }
    if (p.minutos <= lim && caidas[p.codigo]) { delete caidas[p.codigo]; vueltas.push(p.nombre); }
  });
  pr.setProperty('caidas', JSON.stringify(caidas));
  if (nuevas.length) alertar_('Pantalla sin señal: ' + nuevas.join(', '),
    'Estas pantallas llevan más de ' + lim + ' minutos sin conectarse:\n\n' + nuevas.join('\n') +
    '\n\nMientras tanto no muestran el semáforo actualizado. Revisa la energía y el wifi del stick.');
  if (vueltas.length) alertar_('Pantalla de nuevo en línea: ' + vueltas.join(', '),
    'Volvieron a conectarse:\n\n' + vueltas.join('\n'));
}

/* ======================================================================
 * UTILIDADES
 * ==================================================================== */

function norm_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function colOf_(headers, name) { return headers.map(norm_).indexOf(norm_(name)); }
function answer_(namedValues, name) {
  const n = norm_(name);
  for (const k in namedValues) if (norm_(k) === n) return String((namedValues[k] || [''])[0] || '').trim();
  return '';
}
function answerPrefix_(namedValues, prefijo) {
  for (const k in namedValues) if (norm_(k).indexOf(prefijo) === 0) return String((namedValues[k] || [''])[0] || '').trim();
  return '';
}

/** Apagado = No / falso / casilla desmarcada. Vacío = encendido. */
function isNo_(v) { return v === false || /^(no|false|falso|0)$/i.test(String(v === undefined || v === null ? '' : v).trim()); }
function isYes_(v) { return !isNo_(v); }

function toDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** Si "Hasta" viene sin hora (00:00), dura hasta el final de ese día. */
function endOf_(d) {
  if (!d) return null;
  if (Utilities.formatDate(d, TZ, 'HH:mm') === '00:00') return new Date(d.getTime() + 86400000 - 1);
  return d;
}

function driveId_(link) { const m = String(link || '').match(/[-\w]{25,}/); return m ? m[0] : ''; }

function directUrl_(id, tipo) {
  return tipo === 'video'
    ? 'https://drive.google.com/uc?export=download&id=' + id
    : 'https://lh3.googleusercontent.com/d/' + id;
}

function lastTextRow_(sh, col) {
  const n = sh.getLastRow();
  if (n < 1) return 0;
  const v = sh.getRange(1, col, n, 1).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    const x = v[i][0];
    if (x !== '' && x !== null && x !== true && x !== false) return i + 1;
  }
  return 0;
}

function ensureCol_(sh, name) {
  const last = Math.max(sh.getLastColumn(), 1);
  const h = sh.getRange(1, 1, 1, last).getValues()[0];
  const i = colOf_(h, name);
  if (i > -1) return i + 1;
  const c = sh.getLastColumn() + 1;
  sh.getRange(1, c).setValue(name).setFontWeight('bold');
  return c;
}

/* ======================================================================
 * MENÚ E INSTALACIÓN
 * ==================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛡 ' + APP)
    .addItem('🟢 Semáforo VERDE', 'semaforoVerde')
    .addItem('🟡 Semáforo AMARILLA', 'semaforoAmarilla')
    .addItem('🔴 Semáforo ROJA', 'semaforoRoja')
    .addSeparator()
    .addItem('🔄 Recargar todas las pantallas', 'recargarPantallas')
    .addItem('⚙ Instalar / reparar', 'setup')
    .addToUi();
}

/** Crea o repara hojas, Form y disparadores. Se puede correr las veces que haga falta. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);   // la planilla nace con la zona de quien la crea; las horas deben ser de Lima

  prepararAreas_();
  prepararControl_();
  prepararCinta_();
  prepararIndicadores_();
  prepararEstado_();
  prepararBitacora_();
  prepararAsistencia_();
  const form = crearFormulario_(ss);
  prepararRespuestas_();
  actualizarAreasForm_();

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  if (hojaAvisos_() || PropertiesService.getScriptProperties().getProperty('formId')) ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('alEditar').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('revisarPantallas').timeBased().everyMinutes(10).create();

  const hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);

  limpiarCache_();
  toast_('Instalación ' + VERSION + ' lista' + (form ? ': formulario creado (link en la hoja Control).' : '.'));
}

function encabezado_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#DCE6F5');
  sh.setFrozenRows(1);
}

function prepararAreas_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_AREAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_AREAS);
    encabezado_(sh, ['Código', 'Nombre en pantalla']);
    sh.getRange(2, 1, AREAS_INICIALES.length, 2).setValues(AREAS_INICIALES);
    sh.setColumnWidth(2, 280);
  }
  return sh;
}

function prepararControl_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_CONTROL) || ss.insertSheet(SHEET_CONTROL);
  CONTROL.forEach(([clave, etiqueta, valor, tipo]) => {
    if (filaControl_(sh, clave)) return;
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1).setValue(etiqueta).setFontWeight('bold');
    if (tipo === 'casilla') sh.getRange(r, 2).insertCheckboxes().setValue(false);
    else if (clave === 'clave') sh.getRange(r, 2).setNumberFormat('@').setValue(String(100000 + Math.floor(Math.random() * 900000)));
    else if (valor !== '') sh.getRange(r, 2).setNumberFormat('@').setValue(valor);
  });
  const sem = celdaControl_(sh, 'semaforo');
  if (sem) sem.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).build());
  const fec = celdaControl_(sh, 'ultimo accidente');
  if (fec) fec.setNumberFormat('dd/mm/yyyy');
  sh.setColumnWidth(1, 430);
  sh.setColumnWidth(2, 520);
  const pr = PropertiesService.getScriptProperties();
  if (!pr.getProperty('recarga')) pr.setProperty('recarga', String(Date.now()));
  if (!pr.getProperty('semaforoDesde')) pr.setProperty('semaforoDesde', new Date().toISOString());
  return sh;
}

function prepararCinta_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_CINTA);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CINTA);
    encabezado_(sh, ['Texto', 'Áreas', 'Activo', 'Hasta (opcional)']);
    sh.getRange(2, 1, CINTA_INICIAL.length, 4).setValues(CINTA_INICIAL);
    sh.getRange(2, 3, CINTA_INICIAL.length, 1).insertCheckboxes();
    sh.getRange(2, 3, CINTA_INICIAL.length, 1).setValues(CINTA_INICIAL.map(r => [r[2]]));
    sh.setColumnWidth(1, 560);
  }
  return sh;
}

function prepararIndicadores_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_IND);
  if (!sh) {
    sh = ss.insertSheet(SHEET_IND);
    encabezado_(sh, ['Indicador', 'Valor', 'Activo']);
    sh.getRange(2, 1, IND_INICIALES.length, 3).setValues(IND_INICIALES);
    sh.getRange(2, 3, IND_INICIALES.length, 1).insertCheckboxes();
    sh.getRange(2, 3, IND_INICIALES.length, 1).setValues(IND_INICIALES.map(r => [r[2]]));
    sh.setColumnWidth(1, 360);
  }
  return sh;
}

function prepararEstado_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_STATUS);
  if (!sh) { sh = ss.insertSheet(SHEET_STATUS); encabezado_(sh, ['Área', 'Nombre', 'Última conexión', 'Minutos sin señal']); }
  return sh;
}

function prepararBitacora_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_BITACORA);
  if (!sh) { sh = ss.insertSheet(SHEET_BITACORA); encabezado_(sh, ['Fecha y hora', 'Evento', 'Valor', 'Quién', 'Origen']); sh.setColumnWidth(3, 420); }
  return sh;
}

function prepararAsistencia_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_ASIST);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ASIST);
    encabezado_(sh, ['Fecha y hora', 'ID charla', 'Charla', 'Área', 'Nombre', 'DNI / CE', 'Tipo', 'Empresa']);
    sh.setColumnWidth(3, 300);
    sh.setColumnWidth(5, 260);
  }
  return sh;
}

/** Columnas del script en la hoja de respuestas (ID, Aprobado, Activo, URL, Tipo). */
function prepararRespuestas_() {
  const sh = hojaAvisos_();
  if (!sh) return;
  [C.url, C.tipo, C.id, C.aprobado, C.activo].forEach(n => ensureCol_(sh, n));
  if (sh.getLastRow() < 2) return;
  [C.aprobado, C.activo].forEach(n => {
    const rng = sh.getRange(2, ensureCol_(sh, n), sh.getLastRow() - 1, 1);
    const vals = rng.getValues().map(v => [isYes_(v[0])]);
    rng.insertCheckboxes();
    rng.setValues(vals);
  });
}

/** Crea el Form de publicación y lo vincula a esta planilla (solo si todavía no hay uno). */
function crearFormulario_(ss) {
  if (hojaAvisos_() || PropertiesService.getScriptProperties().getProperty('formId')) return null;
  const form = FormApp.create(APP + ' · Publicar en pantallas');
  form.setDescription('Avisos para las pantallas de seguridad de la unidad. Si la planilla lo exige, ' +
    'HSE debe aprobarlos antes de que salgan en pantalla.');
  form.addTextItem().setTitle(Q.titulo).setRequired(true);
  form.addListItem().setTitle(Q.categoria).setChoiceValues(CATEGORIAS).setRequired(true);
  form.addTextItem().setTitle('Archivo (link de Google Drive, opcional)')
    .setHelpText('Imagen JPG/PNG de 1920×850 px o video MP4 guardado en Drive. Sin archivo, el aviso sale como texto.');
  form.addParagraphTextItem().setTitle(Q.texto);
  form.addTextItem().setTitle(Q.link)
    .setHelpText('Opcional. En una "Charla de 5 minutos" el QR de asistencia se crea solo.');
  form.addTextItem().setTitle(Q.cinta).setHelpText('Opcional: texto breve que corre en la franja inferior.');
  form.addDateTimeItem().setTitle(Q.desde).setRequired(true);
  form.addDateTimeItem().setTitle(Q.hasta).setRequired(true);
  form.addCheckboxItem().setTitle(Q.areas).setChoiceValues(['Todas'].concat(getListaAreas_().map(a => a.nombre))).setRequired(true);
  form.addTextItem().setTitle(Q.dur).setHelpText('Opcional. Por defecto ' + DEFAULT_DUR + ' segundos.')
    .setValidation(FormApp.createTextValidation().requireNumberBetween(5, 300).build());
  form.addMultipleChoiceItem().setTitle(Q.prio).setChoiceValues(['Normal', 'URGENTE']).setRequired(true);
  form.addTextItem().setTitle(Q.autor).setRequired(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('formId', form.getId());
  const c = celdaControl_(ss.getSheetByName(SHEET_CONTROL) || prepararControl_(), 'formulario');
  if (c) c.setValue(form.getPublishedUrl());
  return form;
}

/** Las opciones "Áreas" del Form siguen a la hoja Áreas. */
function actualizarAreasForm_() {
  const id = PropertiesService.getScriptProperties().getProperty('formId');
  if (!id) return;
  try {
    const form = FormApp.openById(id);
    const item = form.getItems().filter(i => norm_(i.getTitle()) === norm_(Q.areas))[0];
    if (item) item.asCheckboxItem().setChoiceValues(['Todas'].concat(getListaAreas_().map(a => a.nombre)));
  } catch (e) {
    console.warn('No se pudieron actualizar las áreas del Form: ' + e);
  }
}
