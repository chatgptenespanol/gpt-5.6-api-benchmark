# Protocolo: benchmark GPT-5.6 en español neutro

Versión: `gpt56-neutral-es-v1.0.0`  
Fecha de congelación prevista: 17 de agosto de 2026  
Autor: Ahmed Aly, chatgpt-gratis.chat  
Estado: se congela antes de la primera salida puntuable.

## Objetivo

Comparar `gpt-5.6-sol`, `gpt-5.6-terra` y `gpt-5.6-luna` en un conjunto pequeño y público de tareas sintéticas en español neutro. El benchmark no pretende decidir qué modelo es mejor en general. Mide únicamente el cumplimiento de los criterios publicados bajo esta configuración y fecha.

La matriz contiene 12 tareas, tres modelos y tres repeticiones independientes: **108 salidas canónicas puntuables**. Cada tarea tiene cinco reglas binarias. No existe un juez LLM ni se elige la respuesta más favorable.

## Configuración fija

| Campo | Valor |
|---|---|
| Interfaz | Responses API (`POST /v1/responses`) |
| Modelos | IDs explícitos Sol, Terra y Luna; no se usa el alias `gpt-5.6` |
| Razonamiento | `reasoning.effort: "low"` |
| Límite de salida | `max_output_tokens: 800` |
| Formato | Structured Outputs, JSON Schema estricto específico por tarea |
| Almacenamiento solicitado | `store: false` |
| Herramientas | Ninguna (`tools: []`) |
| Streaming | Desactivado |
| Estado conversacional | Cada celda es una petición independiente |
| Datos | Ficticios y publicados; sin información personal real |

Las páginas públicas de los modelos no mostraban un snapshot fechado diferente para estos IDs al congelar el protocolo. Por ello, se registran el modelo solicitado, el modelo devuelto y la hora UTC. Repetir las llamadas más adelante puede producir respuestas distintas.

Una respuesta solo se vuelve canónica si el campo `model` devuelto coincide exactamente con el ID explícito solicitado. Si el servicio devuelve otro ID o un snapshot fechado, la ejecución se detiene antes de canonizarlo y el protocolo debe documentar ese cambio en una versión nueva.

## Orden y repeticiones

Se ejecuta por tarea `T01`–`T12`. Para reducir una ventaja temporal fija, el orden de modelos rota por repetición:

1. Sol → Terra → Luna.
2. Terra → Luna → Sol.
3. Luna → Sol → Terra.

Las primeras tres celdas son también la prueba técnica inicial y, si producen respuestas HTTP válidas, cuentan como resultados canónicos. No hay calentamiento oculto. Una respuesta de contenido válida pero incorrecta no se repite.

## Evaluación

Cada salida recibe cinco decisiones binarias, `R1`–`R5`:

- regla cumplida: 1;
- regla incumplida: 0;
- resultado: 0–5 y su equivalente 0–100;
- aprobación: al menos 4/5 y ningún fallo crítico;
- tarea estable para un modelo: al menos dos de las tres repeticiones aprueban.

JSON no analizable, negativa, respuesta incompleta o violación del esquema estricto: 0/5. Las tareas relacionales y algorítmicas devuelven resultados JSON sobre fixtures cerrados; el evaluador no ejecuta SQL ni código generado por el modelo. Los tests positivos, negativos, críticos y de JSON inválido están publicados.

Métricas primarias por modelo:

1. reglas cumplidas / 180;
2. salidas aprobadas / 36;
3. tareas estables / 12;
4. fallos críticos;
5. rango de puntuaciones entre repeticiones.

Latencia, uso de tokens y coste son métricas descriptivas secundarias. No entran en la nota de calidad. El coste se recalcula con la tarifa oficial consultada el día de ejecución y el uso reportado por la API.

## Errores y reintentos

No se reintentan respuestas HTTP válidas que sean incorrectas, incompletas, negativas o no superen el evaluador. Solo se permiten dos reintentos técnicos, además del intento inicial, para errores de red, timeout, `408`, `409`, `429` transitorio o `500/502/503/504`. No se reintentan errores de autenticación, saldo, facturación o límite de gasto. Cada intento se conserva; nunca se sobrescribe una respuesta canónica.

Si una celda no produce respuesta canónica tras los reintentos, se detiene la ejecución y no se publica una comparación completa hasta resolver la infraestructura. La primera respuesta utilizable observada es la canónica.

## Integridad y privacidad

- El token de API solo existe en memoria durante la ejecución y nunca se escribe en archivos.
- Solicitudes publicadas no contienen la cabecera `Authorization`.
- Se conservan prompts, esquemas, respuestas literales, metadatos de uso, tiempos del cliente, reglas, resultados y errores redactados.
- Antes de cada llamada se conserva una intención de intento. Si una interrupción deja una intención sin respuesta, la reanudación se bloquea para evitar pagar dos veces o ocultar un intento perdido.
- La reserva de coste usa un bloqueo global y un libro persistente antes de cada llamada; dos procesos concurrentes no pueden aprobar reservas contra el mismo saldo observado.
- No se publican cookies, datos de cuenta, facturación ni identificadores personales.
- Todas las entradas son sintéticas. Antes de escribir una respuesta se aplica un control cerrado que detiene la ejecución y conserva solo un hash si detecta la clave activa, una cabecera de autorización, un token secreto, un identificador de cuenta, un correo ajeno al dominio reservado `example.test` o un teléfono distinto del fixture ficticio publicado.
- Los archivos congelados se protegen con SHA-256 antes de ejecutar; cualquier modificación obliga a una versión nueva y a repetir las 108 celdas.

`store:false` no equivale a Zero Data Retention. Describe el parámetro enviado; la política de retención aplicable sigue siendo la documentada por OpenAI.

## Límites obligatorios al citar resultados

- Doce tareas sintéticas no representan todos los usos en español.
- Cinco reglas por tarea simplifican la calidad; no miden creatividad abierta, verdad web, imágenes, audio, archivos ni uso de herramientas.
- Tres repeticiones muestran variación limitada y no sustentan superioridad universal.
- La latencia depende de red, región, carga, caché y cuenta.
- El mismo sitio diseñó y ejecutó el conjunto; publicar los datos facilita auditoría, pero no elimina ese sesgo.
- “Español neutro” se operacionaliza con prompts revisados y una lista pública limitada de regionalismos; no es una categoría lingüística absoluta.

## Fuentes oficiales consultadas

Acceso y verificación: 17 de agosto de 2026.

- [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model)
- [Compare models](https://developers.openai.com/api/docs/models/compare)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Responses API migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Your data](https://developers.openai.com/api/docs/guides/your-data)
