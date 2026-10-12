# Vigía HSE — contexto para Claude Code

Señalética digital de seguridad para unidades mineras en Perú: charla de 5 minutos con asistencia por QR,
semáforo de tormenta eléctrica, alerta urgente, avisos con aprobación de HSE e indicadores.
Nació como fork de `~/GitHub/pantallas` (pantallas del condominio San Alfonso del Mar).
Dueño: Mario Villalobos. Responde en español de Chile, directo. Mario no es programador: tú haces git, clasp y deploy;
a él le pides solo lo que requiere su mano (autorizar permisos, mirar el TV).

## Arquitectura

```
HSE → Google Form → Sheet "Vigía HSE" (+ Apps Script = backend JSON)  ←  control.html (sala de control, POST con clave)
                                   ↓  GET ?area=GARITA cada 20 s           ←  asistencia.html (QR de la charla, POST)
GitHub Pages (index.html = player) ← App Android "Vigía HSE" (WebView) en el stick → TV
```

| Ruta | Qué es | Cómo se publica |
|---|---|---|
| `index.html` | Player del TV (semáforo, alerta, avisos, cinta, clima, indicadores). `?demo=verde|amarilla|roja|alerta|sinsenal` | `git push` → https://mavillal.github.io/vigia-hse/ |
| `control.html` | Sala de control: semáforo (doble toque), alerta urgente, estado de pantallas, bitácora | idem |
| `asistencia.html` | Registro de asistencia desde el celular (QR de cada charla) | idem |
| `config.js` | URL `/exec` del backend, compartida por las 3 páginas | idem |
| `apps-script/Code.gs` | Backend | `clasp push --force` + `clasp deploy -i <ID>` |
| `apps-script/tests/suite.js` | Pruebas con Sheet simulada | `node apps-script/tests/suite.js apps-script/Code.gs` → debe decir TODO OK |
| `android/` | App kiosco (paquete `pe.vigia.hse`) | push a `android/**` → GitHub Actions → Release |

- Sheet: https://docs.google.com/spreadsheets/d/18wx9Ws37RKYSrLq8CL3qFDX4DLMaqCieWWoVxnXMFbw
- scriptId `1sNzHzuwROmj4NRoattv8BZ3IS0_1GFKdinKvod00oQ34PeB1D7Opk4wA` (en `apps-script/.clasp.json`, no va al repo)
- Web app (deploymentId de los TV): `AKfycbzCVG8fk5Skg7hQGiO_NB5dgpMxMiBMKJbR_oa-seOWnM7cp_VcJEqFmqk3ElNTW8yM`
- Publicar backend, desde `apps-script/`:
  `clasp push --force && clasp deploy -i AKfycbzCVG8fk5Skg7hQGiO_NB5dgpMxMiBMKJbR_oa-seOWnM7cp_VcJEqFmqk3ElNTW8yM -d "vX.Y"`
  y verificar `curl -sL "<URL>?area=GARITA"` (campo `version`).

## Reglas del producto

- Todo en español. Hora de Lima (`America/Lima`). Emergencias Perú: SAMU 106, Bomberos 116, Policía 105.
- Columnas por nombre de encabezado (`norm_`), Control por etiqueta en la columna A. Nunca por posición.
- **Seguridad del semáforo**: la pantalla nunca muestra un semáforo viejo como vigente. Si el player pasa 90 s sin
  respuesta del backend → "Sin señal · confirme por radio". El APK, si no carga ni la copia guardada, muestra
  "Sin conexión" (nunca un semáforo). El sistema complementa sirena y radio; no las reemplaza.
- Cambios de semáforo y alerta urgente quedan en la hoja Bitácora (quién, cuándo, desde dónde).
- Avisos del Form: si Control → "requieren aprobación" = Sí, salen solo con la casilla Aprobado marcada.
- Charla (categoría "Charla de 5 minutos"): el player pone un QR a `asistencia.html?c=<ID>&a=<ÁREA>`.
- El APK se mantiene casi fijo: todo lo visual va en el player o en la Sheet.

## APK

versionCode = `git rev-list --count HEAD`; tag `v1.0.<n>`. Firma PKCS12 alias `vigia` en los secretos
`KEYSTORE_B64` y `KEYSTORE_PASS`; copia local en `secretos-github.txt` y `vigia-release.p12` (NO van al repo).
Instalar en el stick: Downloader → https://github.com/mavillal/vigia-hse/releases/latest/download/vigia-hse.apk
