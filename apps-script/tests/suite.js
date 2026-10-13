// Pruebas del backend con una Sheet simulada:  node apps-script/tests/suite.js apps-script/Code.gs
const fs = require('fs');

// ---------- Mock de Google Sheets ----------
class Sheet {
  constructor(name, data){ this.name=name; this.d=(data||[]).map(r=>r.slice()); this.val={}; this.fmt={}; this.formUrl=null; this.maxR=1000; this.maxC=26; }
  getName(){ return this.name; }
  getFormUrl(){ return this.formUrl; }
  getLastRow(){ for(let i=this.d.length-1;i>=0;i--) if(this.d[i].some(v=>v!==''&&v!==null&&v!==undefined)) return i+1; return 0; }
  getLastColumn(){ let m=0; this.d.forEach(r=>{for(let j=r.length-1;j>=0;j--) if(r[j]!==''&&r[j]!==undefined&&r[j]!==null){m=Math.max(m,j+1);break;}}); return m; }
  getMaxRows(){ return this.maxR; } getMaxColumns(){ return this.maxC; }
  getDataRange(){ return this.getRange(1,1,Math.max(this.getLastRow(),1),Math.max(this.getLastColumn(),1)); }
  getRange(r,c,nr,nc){ return new Range(this,r,c,nr||1,nc||1); }
  get(r,c){ return (this.d[r-1]||[])[c-1] ?? ''; }
  set(r,c,v){ while(this.d.length<r) this.d.push([]); const row=this.d[r-1]; while(row.length<c) row.push(''); row[c-1]=v; }
  appendRow(a){ const r=this.getLastRow()+1; a.forEach((v,i)=>this.set(r,i+1, (typeof v==='string' && /^\d+$/.test(v)) ? Number(v) : v)); }
  setFrozenRows(){} setColumnWidth(){}
}
const disp = v => v===true?'TRUE':v===false?'FALSE':v instanceof Date?v.toISOString():v===null||v===undefined?'':String(v);
class Range {
  constructor(sh,r,c,nr,nc){ Object.assign(this,{sh,r,c,nr,nc}); }
  getRow(){return this.r;} getColumn(){return this.c;} getLastRow(){return this.r+this.nr-1;} getLastColumn(){return this.c+this.nc-1;}
  getSheet(){ return this.sh; }
  getValues(){ const o=[]; for(let i=0;i<this.nr;i++){const row=[];for(let j=0;j<this.nc;j++) row.push(this.sh.get(this.r+i,this.c+j)); o.push(row);} return o; }
  getValue(){ return this.sh.get(this.r,this.c); }
  getDisplayValues(){ return this.getValues().map(r=>r.map(disp)); }
  setValues(v){ v.forEach((row,i)=>row.forEach((x,j)=>this.sh.set(this.r+i,this.c+j,x))); return this; }
  setValue(x){ for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++) this.sh.set(this.r+i,this.c+j,x); return this; }
  insertCheckboxes(){ for(let i=0;i<this.nr;i++)for(let j=0;j<this.nc;j++){ this.sh.val[(this.r+i)+','+(this.c+j)]='cb'; const v=this.sh.get(this.r+i,this.c+j); if(v!==true&&v!==false) this.sh.set(this.r+i,this.c+j,false);} return this; }
  setDataValidation(v){ this.sh.val[this.r+','+this.c]=v; return this; }
  getDataValidation(){ return this.sh.val[this.r+','+this.c] || null; }
  setFontWeight(){return this;} setBackground(){return this;} setNumberFormat(){return this;} setFormula(){return this;}
}
const sheets = {}; const order = [];
const ss = {
  getSheetByName:n=>sheets[n]||null, insertSheet:n=>{ order.push(n); return (sheets[n]=new Sheet(n)); },
  deleteSheet:s=>{ delete sheets[s.name]; order.splice(order.indexOf(s.name),1); },
  getSheets:()=>order.map(n=>sheets[n]), getId:()=>'ssid', setSpreadsheetTimeZone(tz){ ss.tz=tz; }, getUrl:()=>'https://docs.google.com/spreadsheets/d/ssid', toast:m=>console.log('  [toast]',m)
};
const props = {};
global.SpreadsheetApp = { getActive:()=>ss, flush(){}, getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})}),
  newDataValidation:()=>({requireValueInList(l){this.l=l;return this}, build(){return {lista:this.l}}}) };
global.PropertiesService = { getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v}) };
const triggers = [];
global.ScriptApp = { getProjectTriggers:()=>triggers.slice(), deleteTrigger(t){ triggers.splice(triggers.indexOf(t),1); },
  newTrigger:f=>{ const t={f}; return {forSpreadsheet(){return this},onFormSubmit(){t.k='form';return this},onEdit(){t.k='edit';return this},timeBased(){t.k='time';return this},everyMinutes(){return this},create(){triggers.push(t)}}; } };
const p2 = n=>String(n).padStart(2,'0');
global.Utilities = {
  formatDate:(d,tz,f)=>{ const x=new Date(d.getTime()-5*3600e3); return f.replace('yyyy',x.getUTCFullYear()).replace('MM',p2(x.getUTCMonth()+1)).replace('dd',p2(x.getUTCDate())).replace('HH',p2(x.getUTCHours())).replace('mm',p2(x.getUTCMinutes())); },
  getUuid:()=>'abcd1234-'+Math.random().toString(16).slice(2,10)
};
const cacheMem = {}; let cacheOn = false;
global.CacheService = { getScriptCache:()=>({ get:k=>cacheOn?(cacheMem[k]||null):(k==='claveFallos'?cacheMem[k]||null:null), put:(k,v)=>{ if(cacheOn||k==='claveFallos') cacheMem[k]=v; }, removeAll:ks=>ks.forEach(k=>delete cacheMem[k]) }) };
const mails = [];
global.MailApp = { sendEmail:(to,subj,body)=>mails.push({to,subj,body}) };
global.LockService = { getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}}) };
global.Session = { getActiveUser:()=>({getEmail:()=>'hse@mina.pe'}) };
global.DriveApp = { Access:{ANYONE_WITH_LINK:1}, Permission:{VIEW:1}, getFileById:id=>({setSharing(){}, getMimeType:()=> id.startsWith('vid')?'video/mp4':id.startsWith('pdf')?'application/pdf':'image/png'}) };
global.ContentService = { MimeType:{JSON:1}, createTextOutput:t=>({setMimeType(){return t}}) };
let theForm = null;
const item = ()=>{ const it={title:'',choices:[]}; Object.assign(it,{setTitle(t){it.title=t;return it},setRequired(){return it},setHelpText(){return it},setValidation(){return it},setChoiceValues(v){it.choices=v;return it},getTitle(){return it.title},asCheckboxItem(){return it}}); return it; };
global.FormApp = {
  DestinationType:{SPREADSHEET:1},
  createTextValidation:()=>({requireNumberBetween(){return this},build(){return {}}}),
  create:title=>{ theForm={title,items:[]}; const add=()=>{const i=item(); theForm.items.push(i); return i;};
    Object.assign(theForm,{setDescription(){},addTextItem:add,addListItem:add,addParagraphTextItem:add,addDateTimeItem:add,addCheckboxItem:add,addMultipleChoiceItem:add,
      getItems(){return theForm.items}, getId(){return 'formid'}, getPublishedUrl(){return 'https://forms.gle/vigia'},
      setDestination(){ const sh=ss.insertSheet('Respuestas de formulario 1'); sh.formUrl='https://docs.google.com/forms/d/formid'; sh.d=[['Marca temporal'].concat(theForm.items.map(i=>i.title))]; }});
    return theForm; },
  openById:()=>theForm
};
eval(fs.readFileSync(process.argv[2],'utf8') + '\nObject.assign(global,{doGet,doPost,setup,onFormSubmit,alEditar,revisarPantallas,recargarPantallas,lastTextRow_,matchArea_,estado_});');

let ok = true; const check=(cond,msg)=>{ console.log((cond?'  OK   ':'  FALLA ')+msg); if(!cond) ok=false; };
const get = p => JSON.parse(doGet({parameter:p}));
const post = b => JSON.parse(doPost({postData:{contents:JSON.stringify(b)}}));
const ctl = () => sheets['Control'];
const ctlVal = k => { const r = ctl().d.find(r=>norm_(r[0]).indexOf(k)>-1); return r ? r[1] : undefined; };
const ctlSet = (k,v) => { const i = ctl().d.findIndex(r=>norm_(r[0]).indexOf(k)>-1); ctl().set(i+1,2,v); alEditar({range:ctl().getRange(i+1,2)}); };

console.log('\n1) setup en una planilla vacía');
ss.insertSheet('Hoja 1');
setup();
['Áreas','Control','Cinta','Indicadores','Estado','Bitácora','Asistencia','Respuestas de formulario 1'].forEach(n=>check(!!sheets[n], 'hoja '+n));
check(!sheets['Hoja 1'], 'se borra la "Hoja 1" vacía');
check(theForm && theForm.items.length===12, 'Form creado con 12 preguntas');
check(theForm.items.find(i=>i.title==='Áreas').choices.join('|')==='Todas|Garita de ingreso|Comedor del campamento|Taller de mantenimiento', 'el Form ofrece las áreas de la hoja Áreas');
const R = sheets['Respuestas de formulario 1'];
check(['URL','Tipo','ID','Aprobado','Activo'].every(c=>R.d[0].includes(c)), 'respuestas con columnas URL, Tipo, ID, Aprobado, Activo');
check(/^\d{6}$/.test(ctlVal('clave')), 'clave de sala de control generada: '+ctlVal('clave'));
check(ctlVal('formulario')==='https://forms.gle/vigia', 'link del Form anotado en Control');
check(triggers.map(t=>t.k).sort().join()==='edit,form,time', 'disparadores: Form, edición y revisión cada 10 min');
setup();
check(Object.keys(sheets).filter(n=>/^Respuestas/.test(n)).length===1 && triggers.length===3, 'setup por segunda vez no duplica Form ni disparadores');

console.log('\n2) Pantalla de un área');
const g = get({area:'GARITA'});
check(g.version==='v1.2' && ss.tz==='America/Lima' && g.areaNombre==='Garita de ingreso', 'GARITA → "Garita de ingreso" y planilla en hora de Lima');
check(g.semaforo.estado==='VERDE' && /Sin tormenta/.test(g.semaforo.mensaje), 'semáforo inicial VERDE con su mensaje');
check(g.alerta===null, 'sin alerta urgente');
check(g.cinta.length===2 && get({area:'TALLER'}).cinta.length===3, 'cinta: el aviso solo de TALLER no sale en GARITA');
check(g.clima && g.clima.lat===-16.53, 'coordenadas del clima desde Control');
check(get({}).listaAreas.length===3, 'sin área: lista de 3 áreas');

console.log('\n3) Publicar desde el Form, con aprobación de HSE');
const submit = vals => { const hh=R.d[0].slice(); const row=R.getLastRow()+1; hh.forEach((h,i)=>R.set(row,i+1, vals[h]!==undefined?vals[h]:'')); const nv={}; hh.forEach(h=>nv[h]=[vals[h] instanceof Date?vals[h].toISOString():(vals[h]||'')]); onFormSubmit({range:R.getRange(row,1,1,hh.length), namedValues:nv}); return row; };
const col = n => R.d[0].indexOf(n)+1;
const ayer = new Date(Date.now()-86400e3), manana = new Date(Date.now()+86400e3);
mails.length = 0;
const rCharla = submit({'Título':'Tres puntos de contacto','Categoría':'Charla de 5 minutos','Texto del aviso':'Al subir o bajar de un equipo…','Desde':ayer,'Hasta':manana,'Áreas':'Garita de ingreso, Taller de mantenimiento','Prioridad':'Normal','Publicado por':'Supervisor Quispe'});
check(get({area:'GARITA'}).items.length===0, 'sin aprobar, no sale en pantalla');
check(mails.length===1 && /pendiente de aprobación/.test(mails[0].subj) && /Supervisor Quispe/.test(mails[0].body), 'llega correo "pendiente de aprobación"');
R.set(rCharla, col('Aprobado'), true); alEditar({range:R.getRange(rCharla, col('Aprobado'))});
const items = get({area:'GARITA'}).items;
const idCharla = R.get(rCharla, col('ID'));
check(items.length===1 && items[0].tipo==='texto' && items[0].charla===idCharla && /^[0-9a-f]{8}$/.test(idCharla), 'aprobada: sale como tarjeta de charla con ID '+idCharla);
check(get({area:'COMEDOR'}).items.length===0, 'no sale en COMEDOR (no estaba elegida)');
ctlSet('aprobacion','No');
const rImg = submit({'Título':'Campaña EPP','Categoría':'Campaña','Archivo (link de Google Drive, opcional)':'https://drive.google.com/file/d/img1234567890123456789012345/view','Desde':ayer,'Hasta':manana,'Áreas':'Todas','Prioridad':'Normal','Publicado por':'HSE'});
check(R.get(rImg,col('Tipo'))==='imagen' && /lh3/.test(R.get(rImg,col('URL'))) && R.get(rImg,col('Aprobado'))===true, 'sin aprobación obligatoria: imagen de Drive aprobada sola');
check(get({area:'COMEDOR'}).items.length===1, 'y aparece en COMEDOR');
const rPdf = submit({'Título':'Procedimiento PDF','Categoría':'Aviso general','Archivo (link de Google Drive, opcional)':'https://drive.google.com/file/d/pdf1234567890123456789012345/view','Desde':ayer,'Hasta':manana,'Áreas':'Todas','Prioridad':'Normal','Publicado por':'HSE'});
check(/^ERROR/.test(R.get(rPdf,col('Tipo'))) && mails.some(m=>/Procedimiento PDF/.test(m.subj)), 'un PDF queda con ERROR y avisa por correo');
submit({'Título':'Evacuación por derrame en chancado','Categoría':'Alerta de seguridad','Texto del aviso':'Diríjase al punto de reunión 3','Desde':ayer,'Hasta':manana,'Áreas':'Todas','Prioridad':'URGENTE','Publicado por':'HSE'});
const gu = get({area:'GARITA'});
check(gu.urgente && gu.items.length===1 && gu.items[0].titulo==='Evacuación por derrame en chancado', 'URGENTE: solo el aviso urgente rota');
R.set(R.getLastRow(), col('Activo'), false); alEditar({range:R.getRange(R.getLastRow(), col('Activo'))});
submit({'Texto para la cinta':'Simulacro de sismo el jueves 10:00','Título':'Simulacro','Desde':ayer,'Hasta':manana,'Áreas':'Comedor del campamento','Prioridad':'Normal','Publicado por':'HSE'});
check(get({area:'COMEDOR'}).cinta.some(x=>x.es==='Simulacro de sismo el jueves 10:00') && !get({area:'GARITA'}).cinta.some(x=>/Simulacro/.test(x.es)), 'texto para la cinta solo en COMEDOR');
check(!sheets['Cinta'].d.some(r=>/Simulacro/.test(r[0])), 'la cinta del Form no se copia a la hoja Cinta');
ctlSet('aprobacion','Sí'); mails.length = 0;
const rCin = submit({'Texto para la cinta':'Reporte flash: revise las recomendaciones','Título':'Reporte','Desde':ayer,'Hasta':manana,'Áreas':'Todas','Prioridad':'Normal','Publicado por':'HSE'});
check(!get({area:'GARITA'}).cinta.some(x=>/Reporte flash/.test(x.es)) && mails.some(m=>/pendiente de aprobación/.test(m.subj)), 'con aprobación obligatoria, la cinta del Form espera y avisa por correo');
R.set(rCin, col('Aprobado'), true); alEditar({range:R.getRange(rCin, col('Aprobado'))});
check(get({area:'GARITA'}).cinta.some(x=>/Reporte flash/.test(x.es)), 'al aprobar, aparece en la cinta');
R.set(rCin, col('Hasta'), ayer);
check(!get({area:'GARITA'}).cinta.some(x=>/Reporte flash/.test(x.es)), 'vencida, sale de la cinta');

console.log('\n4) Sala de control: clave, semáforo y alerta');
const clave = ctlVal('clave');
check(post({accion:'estado',clave:'000000'}).error==='Clave incorrecta.', 'clave incorrecta rechazada');
check(post({accion:'semaforo',clave,estado:'ROJA'}).error==='Escribe quién hace el cambio.', 'exige quién hace el cambio');
check(post({accion:'semaforo',clave,estado:'NARANJA',quien:'x'}).ok===false, 'estado inválido rechazado');
cacheOn = true;
get({area:'GARITA'});                                          // queda en caché
const est = post({accion:'semaforo',clave,estado:'ROJA',quien:'Operador Huamán'});
check(est.ok && est.semaforo.estado==='ROJA' && ctlVal('semaforo')==='ROJA', 'POST semáforo ROJA → hoja Control en ROJA');
const gr = get({area:'GARITA'});
check(gr.semaforo.estado==='ROJA' && /Suspenda/.test(gr.semaforo.mensaje), 'la pantalla ve ROJA al instante (se borra la caché)');
check(est.bitacora[0].evento==='Semáforo' && est.bitacora[0].valor==='ROJA' && est.bitacora[0].quien==='Operador Huamán' && est.bitacora[0].origen==='Sala de control', 'bitácora: quién, cuándo y desde dónde');
const al = post({accion:'alerta',clave,texto:'Sismo: evacúe a la zona segura',quien:'Operador Huamán'});
check(al.alerta && al.alerta.texto==='Sismo: evacúe a la zona segura' && get({area:'TALLER'}).alerta.texto==='Sismo: evacúe a la zona segura', 'alerta urgente en todas las áreas');
check(post({accion:'alerta',clave,texto:'',quien:'Operador Huamán'}).alerta===null && get({area:'TALLER'}).alerta===null, 'quitar alerta');
ctlSet('semaforo','amarilla');
check(ctlVal('semaforo')==='AMARILLA' && get({area:'GARITA'}).semaforo.estado==='AMARILLA', 'cambio desde la planilla: "amarilla" → AMARILLA, sin esperar la caché');
check(sheets['Bitácora'].d.slice(-1)[0][3]==='hse@mina.pe' && sheets['Bitácora'].d.slice(-1)[0][4]==='Planilla', 'cambio en la planilla también queda en la bitácora');
semaforoVerde();
check(get({area:'GARITA'}).semaforo.estado==='VERDE', 'menú 🟢 Semáforo VERDE');
cacheOn = false;
for (let i=0;i<10;i++) post({accion:'estado',clave:'1'});
check(/Demasiados intentos/.test(post({accion:'estado',clave}).error), 'tras 10 claves erróneas se bloquea 10 minutos');
delete cacheMem.claveFallos;

console.log('\n5) Asistencia por QR');
const info = get({charla:idCharla});
check(info.ok && info.vigente && info.titulo==='Tres puntos de contacto', 'GET ?charla=ID trae el título');
const base = {accion:'asistencia',charla:idCharla,area:'GARITA',nombre:'Rosa Mamani Ccori',dni:'01234567',tipo:'Propio'};
const a1 = post(base);
check(a1.ok && !a1.repetido, 'registro válido: '+a1.mensaje);
const A = sheets['Asistencia'];
check(A.get(2,6)==='01234567' && A.get(2,4)==='Garita de ingreso' && A.get(2,3)==='Tres puntos de contacto', 'fila con DNI (con cero inicial), área y charla');
check(post(base).repetido===true && A.getLastRow()===2, 'el mismo DNI no se registra dos veces');
check(/empresa/.test(post(Object.assign({},base,{dni:'44556677',tipo:'Contrata'})).error), 'contrata sin empresa: pide la empresa');
check(post(Object.assign({},base,{dni:'44556677',tipo:'Contrata',empresa:'Servicios Mineros SAC'})).ok && A.get(3,8)==='Servicios Mineros SAC', 'contrata con empresa registrada');
check(/DNI/.test(post(Object.assign({},base,{dni:'12'})).error), 'DNI inválido rechazado');
check(/nombre y apellido/.test(post(Object.assign({},base,{nombre:'Rosa',dni:'99887766'})).error), 'nombre sin apellido rechazado');
check(get({charla:'zzzz'}).ok===false, 'charla inexistente');
R.set(rCharla, col('Hasta'), ayer);
check(post(Object.assign({},base,{dni:'11223344'})).ok===false && get({charla:idCharla}).vigente===false, 'charla vencida: registro cerrado');

console.log('\n6) Indicadores');
const hace = new Date(Date.now()-45*86400e3);
const fr = ctl().d.findIndex(r=>norm_(r[0]).indexOf('ultimo accidente')>-1)+1; ctl().set(fr,2,hace);
const ind = get({area:'GARITA'}).indicadores;
check(ind[0].nombre==='Días sin accidentes incapacitantes' && ind[0].valor==='45', 'días sin accidentes calculado: '+ind[0].valor);
check(ind.length===3, 'más los 2 de la hoja Indicadores');

console.log('\n7) Estado de las pantallas y aviso por correo');
cacheOn = true;
doGet({parameter:{area:'XXX',ping:'1'}});
doGet({parameter:{area:'GARITA',ping:'1'}}); doGet({parameter:{area:'TALLER',ping:'1'}});
const E = sheets['Estado'];
check(E.getLastRow()===3 && !E.d.some(r=>r[0]==='XXX'), 'Estado anota GARITA y TALLER, no áreas inventadas');
cacheOn = false;
mails.length = 0;
E.set(2,3,new Date(Date.now()-40*60000));
revisarPantallas();
check(mails.length===1 && /Pantalla sin señal: Garita de ingreso/.test(mails[0].subj), 'correo: GARITA lleva 40 min sin señal');
revisarPantallas();
check(mails.length===1, 'no repite el correo mientras siga caída');
E.set(2,3,new Date());
revisarPantallas();
check(mails.length===2 && /de nuevo en línea/.test(mails[1].subj), 'correo cuando vuelve');
const sala = post({accion:'estado',clave});
check(sala.pantallas.length===3 && sala.pantallas.find(p=>p.codigo==='COMEDOR').minutos===null, 'sala de control ve las 3 pantallas (COMEDOR nunca conectada)');

console.log('\n8) Utilidades');
check(estado_('Roja')==='ROJA' && estado_('ámbar')==='AMARILLA' && estado_('')==='VERDE', 'estado_ normaliza el semáforo');
check(matchArea_('garita', {codigo:'GARITA',nombre:'Garita de ingreso'}) && !matchArea_('Comedor del campamento', {codigo:'GARITA',nombre:'Garita de ingreso'}), 'matchArea_ por código o nombre');

console.log('\n' + (ok ? 'TODO OK' : 'HAY FALLAS'));
process.exit(ok ? 0 : 1);
