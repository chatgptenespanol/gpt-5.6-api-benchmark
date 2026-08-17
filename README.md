# Benchmark público de GPT-5.6 en español neutro

Versión archivada: [DOI 10.5281/zenodo.21978662](https://doi.org/10.5281/zenodo.21978662)  
Repositorio: [chatgptenespanol/gpt-5.6-api-benchmark](https://github.com/chatgptenespanol/gpt-5.6-api-benchmark)

Paquete reproducible de `chatgpt-gratis.chat` para comparar `gpt-5.6-sol`,
`gpt-5.6-terra` y `gpt-5.6-luna` mediante la Responses API. Incluye 12 tareas
sintéticas, tres repeticiones por modelo, 108 salidas canónicas, reglas
deterministas, solicitudes sin credenciales, respuestas literales, uso,
latencia, resultados derivados y hashes SHA-256.

Este benchmark mide solo el cumplimiento de los criterios publicados bajo la
configuración y fecha registradas. No demuestra que un modelo sea superior en
todos los usos y no es una evaluación oficial de OpenAI.

## Mapa del paquete

- `protocol.md`: objetivo, diseño, orden, reintentos, métricas y límites.
- `benchmark/`: prompts, fixtures, esquemas, reglas, trabajos y manifiesto
  congelado antes de la primera respuesta puntuable.
- `configs/`: configuración pública de cada modelo.
- `evidence/requests/`: cuerpos enviados, sin cabecera de autorización.
- `evidence/attempt-intents/`: reservas persistentes creadas antes de cada llamada.
- `evidence/attempts/`: cada intento técnico, sin sobrescritura.
- `evidence/responses/`: respuestas canónicas literales proyectadas a campos
  públicos.
- `evidence/run-metadata/`: modelo, UTC, latencia, uso y coste estimado.
- `results/`: decisiones por regla y resúmenes calculados.
- `tests/`: fixtures positivos, negativos y críticos del evaluador.
- `checksums.sha256`: integridad de los archivos de la versión publicada.

## Verificar la versión publicada

La versión pública incluye una sustitución sanitizante, declarada y limitada a un literal sintético del test del runner. Verifica primero la cadena publicada con:

```bash
node publication/verify-publication.mjs
node publication/verify-runner-test.mjs
```

Consulta [`PUBLICATION_SANITIZATION.md`](PUBLICATION_SANITIZATION.md) para los hashes anterior y publicado y el alcance exacto. La sustitución no alteró solicitudes, respuestas, evaluación ni resultados.

Los comandos congelados fallan de forma intencionada dentro del árbol público sanitizado. Con Node.js 24 o posterior, materialice una copia temporal exacta antes de ejecutarlos:

```bash
node publication/materialize-frozen-tree.mjs ../gpt56-verificacion
cd ../gpt56-verificacion
npm test
npm run test:runner
npm run test:repository
npm run verify
npm run evaluate
```

`npm run evaluate` no llama a la API: recalcula los resultados desde la
evidencia canónica y exige exactamente las 108 celdas congeladas.

## Repetir las llamadas

Genere una copia nueva para repetición. El modo `--fresh` solo acepta un destino
que todavía no existe, reconstruye el árbol congelado y elimina de esa nueva
copia la evidencia, los resultados, los informes y los checksums de la
ejecución publicada. No modifica el repositorio descargado:

```bash
node publication/materialize-frozen-tree.mjs ../gpt56-repeticion --fresh
cd ../gpt56-repeticion
```

Cree una clave restringida de un proyecto de prueba con acceso de escritura
solo a `/v1/responses`, active únicamente los tres IDs explícitos y ejecute:

```bash
npm test
npm run test:runner
npm run test:repository
npm run verify
npm run run
npm run evaluate
```

El comando `run` lee la clave desde `OPENAI_API_KEY`, no la escribe ni la
imprime y detiene nuevas llamadas antes de superar su límite conservador de
coste. No ponga la clave en un archivo del repositorio. Revóquela al terminar.

Una repetición posterior no tiene por qué devolver el mismo texto: los IDs
públicos pueden evolucionar y la infraestructura cambia. La reproducción
permite auditar el método y recalcular la ejecución fechada; no promete
identidad byte a byte entre fechas.

## Licencias y atribución

El código se publica bajo MIT. Los prompts, fixtures, reglas, resultados
derivados y documentación original se publican bajo CC BY 4.0. Las salidas del
modelo se incluyen como evidencia fechada y siguen sujetas a los términos
aplicables de OpenAI; consulte `LICENSE-DATA`.

Autor: Ahmed Aly, `chatgpt-gratis.chat`. Cite la versión archivada indicada en
`CITATION.cff` o mediante el DOI `10.5281/zenodo.21978662`.
