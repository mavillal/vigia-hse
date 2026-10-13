# Vigía HSE

Pantallas de seguridad para unidades mineras. Cada TV muestra lo que corresponde a su área y cambia en segundos
cuando la sala de control activa una alerta.

**Qué hace**

- **Semáforo de tormenta eléctrica.** La sala de control lo cambia desde `control.html` o desde la planilla.
  En alerta roja la pantalla entera se pone roja con la instrucción de refugio. Cada cambio queda en la bitácora.
- **Alerta urgente.** Un texto que ocupa todas las pantallas hasta que alguien lo quita.
- **Charla de 5 minutos con asistencia por QR.** El trabajador escanea, escribe su nombre y DNI y queda registrado
  en la hoja Asistencia, con su empresa si es de contrata.
- **Avisos con aprobación de HSE.** Se publican desde un Google Form y salen solo cuando HSE marca "Aprobado".
- **Indicadores y cinta.** Días sin accidentes incapacitantes, índices y mensajes de seguridad por área.
- **Pantalla sin señal.** Si un TV pierde la conexión lo dice en pantalla y lo marca en la sala de control: nunca muestra
  un semáforo viejo como si estuviera vigente.

El sistema complementa la sirena, la radio y el detector de tormentas de la unidad. No los reemplaza.

## Enlaces

| | |
|---|---|
| Pantallas y demostración | https://mavillal.github.io/vigia-hse/ |
| Sala de control | https://mavillal.github.io/vigia-hse/control.html |
| Ejemplo de pantalla en alerta roja | https://mavillal.github.io/vigia-hse/?area=DEMO&demo=roja |
| App para el TV (APK) | https://github.com/mavillal/vigia-hse/releases/latest |

## Puesta en marcha

1. Abre la planilla **Vigía HSE** en Google Drive. Menú **🛡 Vigía HSE → ⚙ Instalar / reparar** y autoriza los permisos.
   Crea las hojas, el formulario para publicar y la clave de la sala de control (hoja Control).
2. En la hoja **Control** completa: nombre de la unidad, central de emergencias, latitud y longitud (para el clima),
   fecha del último accidente incapacitante y correo para alertas.
3. En la hoja **Áreas** deja una fila por pantalla (código sin espacios y nombre visible).
4. En cada stick: instala el APK, ábrelo y elige el área.

## Hojas de la planilla

| Hoja | Para qué |
|---|---|
| Respuestas de formulario | Avisos publicados. Columnas del sistema: URL, Tipo, ID, Aprobado, Activo |
| Áreas | Código · Nombre en pantalla |
| Cinta | Texto · Áreas · Activo · Hasta |
| Indicadores | Indicador · Valor · Activo |
| Control | Semáforo, mensajes, alerta urgente, clave, aprobación, clima, correo |
| Estado | Última conexión de cada pantalla |
| Bitácora | Cambios del semáforo y de la alerta urgente |
| Asistencia | Registros de las charlas por QR |

## Para desarrolladores

```bash
node apps-script/tests/suite.js apps-script/Code.gs
```

Detalle técnico y forma de publicar en [CLAUDE.md](CLAUDE.md).
