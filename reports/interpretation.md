# Interpretación conservadora

La ejecución terminó el 17 de agosto de 2026 con 108/108 respuestas canónicas
y sin reintentos técnicos. El coste total estimado a partir del uso reportado
por la API y las tarifas consultadas ese día fue 0,3144348 USD.

| Modelo | Salidas aprobadas | Reglas | Tareas estables | Fallos críticos | Latencia p50 | Coste estimado |
|---|---:|---:|---:|---:|---:|---:|
| Sol | 36/36 | 177/180 (98,3 %) | 12/12 | 0 | 2681 ms | 0,2077800 USD |
| Terra | 35/36 | 175/180 (97,2 %) | 12/12 | 0 | 2131 ms | 0,0953520 USD |
| Luna | 36/36 | 177/180 (98,3 %) | 12/12 | 0 | 2308 ms | 0,0113028 USD |

Sol y Luna empataron en reglas cumplidas y salidas aprobadas dentro de este
conjunto. Terra tuvo una salida no aprobada en la primera repetición de T03,
pero la tarea siguió siendo estable al aprobar dos de tres repeticiones. Las
diferencias restantes fueron principalmente de clasificación y orden exacto.

No se declara un “ganador” general. Luna registró menor coste estimado y una
latencia p50 menor que Sol en esta ejecución, pero coste y latencia no entran en
la puntuación de calidad, dependen de la infraestructura y no prueban ventaja
universal. Consulte `LIMITATIONS.md` y los archivos por ejecución antes de citar
una diferencia.
