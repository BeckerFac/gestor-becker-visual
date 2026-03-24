---
title: "Content Intelligence System - Playbook Generico Replicable"
date: 2026-03-24
tags: [contenido, automatizacion, social-media, playbook, generico]
---

# Content Intelligence System: Playbook Generico para Cualquier Nicho

> Este documento permite a cualquier persona replicar el sistema completo de creacion de contenido profesional que construimos. No requiere conocimiento tecnico previo mas alla de instalar Claude Code.

---

## Que es esto?

Un sistema que usa IA (Claude Code) para:
1. Investigar que contenido esta funcionando en tu nicho AHORA
2. Generar ideas validadas con datos reales (no inventadas)
3. Escribir scripts listos para grabar (reel, carousel, stories)
4. Crear imagenes para carousels
5. Organizar un calendario mensual de publicaciones
6. Repetir todo cada 2-5 dias automaticamente

---

## PASO 0: Instalar las herramientas

### Prerequisitos
1. **Claude Code** instalado (https://docs.anthropic.com/en/docs/claude-code)
2. **Python 3.10+** instalado
3. **ffmpeg** instalado (`sudo apt install ffmpeg` en Linux, `brew install ffmpeg` en Mac)

### Dependencias automaticas
El sistema instala lo que falta automaticamente. Pero si queres instalar manualmente:

```bash
pip3 install --user yt-dlp openai-whisper
```

---

## PASO 1: Crear las 3 Skills fundamentales

Las skills son archivos `.md` que le dicen a Claude Code que hacer cuando ejecutas un comando con `/`. Se guardan en `~/.claude/commands/`.

### Skill 1: `/reel` - Analizar videos de competidores

**Que hace**: Descarga un reel/short/TikTok, extrae audio+video, transcribe, y genera un analisis estrategico completo (hook, estructura, replicabilidad, idea derivada).

**Como crearla**:

```bash
# Crear el archivo
nano ~/.claude/commands/reel.md
```

Pegar el siguiente contenido (ADAPTAR las secciones marcadas con [TU_NICHO]):

```markdown
# /reel - Analyze Social Media Videos

Extract, analyze, and deliver STRATEGIC INSIGHTS from a video.

## Usage
/reel <URL>

Supports: Instagram Reels, TikTok, YouTube Shorts, Facebook Reels.

## Steps (ejecutar automaticamente sin preguntar):

### 1. Setup
REEL_DIR="/tmp/reel-analysis-$(date +%s)"
mkdir -p "$REEL_DIR/frames"

### 2. Download
yt-dlp --no-playlist --write-thumbnail --write-info-json -o "$REEL_DIR/video.%(ext)s" "<URL>"

### 3. Extract frames
ffmpeg -i "$VIDEO_FILE" -vf "fps=1" -q:v 1 "$REEL_DIR/frames/frame_%03d.jpg" -y

### 4. Transcribe audio
ffmpeg -i "$VIDEO_FILE" -vn -acodec libmp3lame "$REEL_DIR/audio.mp3" -y
whisper "$REEL_DIR/audio.mp3" --model small --output_dir "$REEL_DIR" --output_format txt

### 5. Read ALL content (frames + transcription + metadata)

### 6. Deliver strategic analysis:
- Ficha rapida (autor, duracion, engagement)
- Estructura segundo a segundo
- Analisis del hook (tipo, por que funciona, score 1-10)
- Framework usado (Hook-Value-CTA / PAS / AIDA / etc)
- Produccion (formato visual, audio, ritmo de cortes)
- Replicabilidad (dificultad, que se necesita)
- Relevante para [TU_CUENTA]? Score 0-10
- Idea derivada adaptada a [TU_IDIOMA/MERCADO]
- Score final /50
```

### Skill 2: `/youtube` - Investigar videos de YouTube

**Que hace**: Extrae transcripciones y metadata de videos de YouTube para usar como fuente de ideas. Puede buscar videos sobre un tema automaticamente.

**Como crearla**:

```bash
nano ~/.claude/commands/youtube.md
```

```markdown
# /youtube - Extract YouTube Video Info

## Usage
/youtube <URL>                  # Extraer un video
/youtube research <topic>       # Buscar y extraer top videos sobre un tema

## Single Video
1. Buscar el video con WebSearch si no hay URL
2. Descargar metadata y subtitulos con yt-dlp:
   yt-dlp --skip-download --write-subs --write-auto-subs --sub-lang es,en --write-info-json -o "/tmp/yt/video" "<URL>"
3. Leer el archivo de subtitulos generado
4. Resumir: titulo, canal, duracion, temas clave, insights principales

## Research Mode
1. WebSearch: "site:youtube.com <topic>" + variaciones
2. Elegir top 3-5 videos mas relevantes
3. Extraer cada uno
4. Sintetizar: que se cubre, que angulos faltan, que se puede replicar
```

### Skill 3: `/engine` - Motor de contenido completo

**Que hace**: El cerebro del sistema. Ejecutalo cada 2-5 dias y te genera TODO el contenido listo para publicar.

**Como crearla** (este es el mas largo e importante):

```bash
nano ~/.claude/commands/engine.md
```

```markdown
# /engine - Content Intelligence Engine

Full-cycle content system. Research -> Validate -> Script -> Schedule.

## Usage
/engine                     # Ciclo completo
/engine [cuenta]            # Solo una cuenta especifica

## FASE 1: RESEARCH MULTI-FUENTE (lanzar en paralelo)

Usar TODAS estas fuentes simultaneamente:

| Fuente | Busqueda | Que encuentra |
|--------|----------|---------------|
| Web trending | WebSearch "[TU_NICHO] news [AÑO]" | Novedades del sector |
| YouTube | /youtube research "[TU_NICHO] [tema trending]" | Angulos profundos |
| Reddit | WebSearch "site:reddit.com [TU_SUBREDDIT]" | Que le importa a la comunidad |
| Product Hunt | WebSearch "site:producthunt.com [TU_NICHO]" | Productos nuevos |
| Competidores | /reel [URL] en posts outlier de cuentas seguidas | Que formato funciona |
| X/Twitter | WebSearch "site:x.com [LIDER_DE_OPINION]" | Tendencias emergentes |

## FASE 2: VALIDACION

Cada idea debe pasar TODOS estos filtros:
1. FUENTE: Puedo citar de donde salio?
2. FRESCURA: Es de los ultimos 7 dias?
3. ARBITRAJE: Existe en otro idioma/plataforma pero no en la mia?
4. VALOR: El viewer va a aprender o sentir algo?
5. CTA: Puedo adjuntar un lead magnet?
6. PILAR: Entra en mis pilares de contenido?

Falla 1 = descartar y generar mejor.

## FASE 3: GENERACION

Para cada cuenta: 3-4 ideas para los proximos 2-3 dias.
Mix: ~55% reels / ~45% carousels.

### Script de Reel (palabra por palabra):

## REEL: [Titulo]
**Cuenta**: [cuenta] | **Duracion**: Xs | **Framework**: [nombre]
**Fuente**: [de donde salio la idea]

### HOOK (0-3s)
**Decis**: "[palabras exactas]"
**Se ve**: [descripcion visual]
**Pantalla**: "[texto overlay]"

### CUERPO
**0:03-0:08**: [que decis + que se ve]
**0:08-0:15**: [continuacion]
**0:15-0:25**: [entrega de valor principal]

### CTA (ultimos 5s)
**Decis**: "[palabras exactas]"
**Pantalla**: "[texto]"
**Accion**: Comenta "[KEYWORD]" y te mando [que recibe]

### CAPTION (copiar y pegar)
[Hook en primera linea. Keywords SEO. 3-5 hashtags.]

### Script de Carousel (slide por slide):

## CAROUSEL: [Titulo]
**Cuenta**: [cuenta] | **Slides**: X

### SLIDE 1 (TAPA - debe frenar el scroll)
**Headline**: "[texto grande]"

### SLIDES 2-N
**Titulo**: "[titulo]"
**Cuerpo**: "[contenido]"

### ULTIMO SLIDE (CTA)
**Texto**: "[llamada a accion]"

### Stories (3 por dia):
[hora] [tipo] "[contenido]" (sticker: [tipo])
Tipos: poll, question, tip, behind_scenes, cta

### Calendario:
Tabla con fecha, hora, cuenta, formato, titulo, CTA.

## FASE 4: PILARES DE CONTENIDO

[ADAPTAR A TU NICHO - ejemplo:]

**Cuenta principal:**
- Pilar 1 (35%): [tu tema principal]
- Pilar 2 (25%): [tu segundo tema]
- Pilar 3 (25%): [tu tercer tema]
- Pilar 4 (15%): [contenido personal/opinion]

## TONO
- [TU_IDIOMA] [TU_ESTILO] (ej: "Español argentino informal, tuteo")
- Max 1-2 emojis por caption
- Amigo que sabe, no profesor que enseña
```

---

## PASO 2: Configurar para tu nicho

### Definir tus pilares de contenido

Antes de ejecutar `/engine`, tenes que saber:

1. **Tu nicho**: Que tema cubris? (ej: fitness, finanzas, cocina, tech)
2. **Tu audiencia**: Quien te sigue o queres que te siga? (ej: mujeres 25-35 que quieren empezar el gym)
3. **Tus pilares**: 3-4 categorias de contenido que vas a rotar (ej: rutinas 35%, nutricion 25%, motivacion 25%, humor gym 15%)
4. **Tu tono**: Como hablas? (ej: argentino informal, mexicano profesional, español neutro)
5. **Tu diferenciador**: Que tenes vos que otros no? (ej: sos medico, construiste un negocio real, viviste en 5 paises)

### Definir tus fuentes de inteligencia

| Fuente | Tu equivalente |
|--------|---------------|
| Subreddits | r/[tu_nicho], r/[nicho_relacionado] |
| Cuentas IG referentes | @cuenta1, @cuenta2, ... (10-20 cuentas) |
| Canales YouTube | canal1, canal2, ... |
| Newsletters | newsletter1, newsletter2 |
| Hashtags | #hashtag1, #hashtag2 |

---

## PASO 3: Ejecutar

### Primera vez (setup completo)

```
/engine
```

Claude va a:
1. Buscar tendencias en tu nicho en 6+ fuentes
2. Filtrar y validar las mejores ideas
3. Escribir scripts completos para 3-4 reels y 2-3 carousels
4. Planificar 3 stories por dia
5. Armar el calendario de la semana

### Cada 2-5 dias (mantenimiento)

```
/engine
```

Mismo proceso. Claude recuerda que ya publico y no repite ideas.

### Analizar un reel de un competidor

```
/reel https://www.instagram.com/reel/XXXXX
```

### Investigar un tema en YouTube

```
/youtube research "como hacer X en 2026"
```

### Analisis profundo de un tema

```
/analysis "estado actual de [tu tema] en [tu mercado]"
```

---

## PASO 4: Publicar

El sistema genera TODO excepto publicar (eso sigue siendo manual o via Meta Business Suite / Buffer / Metricool).

### Workflow de publicacion

1. `/engine` genera scripts + calendario
2. Grabar reels siguiendo los scripts (CapCut para edicion)
3. Screenshots de los HTML de carousels (o redesenar en Canva)
4. Copiar y pegar captions del script
5. Programar en Meta Business Suite o Buffer
6. Publicar stories manualmente durante el dia

### Herramientas complementarias recomendadas

| Herramienta | Para que | Precio |
|-------------|----------|--------|
| CapCut | Editar reels | Gratis |
| Canva | Carousels + stories | Gratis / $12/mes |
| Buffer | Programar posts | Gratis 3 cuentas |
| Metricool | Analytics + programar | $12/mes |
| ManyChat | Comment triggers automaticos | Gratis hasta 1000 contactos |
| Notion | Organizar ideas | Gratis |

---

## Conceptos clave que este sistema aplica

### 1. Content Arbitrage (arbitraje de contenido)
Tomar ideas que funcionaron en un mercado (ej: ingles) y ser el primero en hacerlas en otro (ej: español). El contenido ya esta validado - solo adaptas.

### 2. Comment Triggers
En vez de "link in bio", pedis que comenten una palabra. Automatizas la respuesta por DM con ManyChat. Click rate: 40-70% (vs 1-3% de link in bio).

### 3. Caption SEO
Instagram funciona como buscador desde 2024. Las keywords en tu caption importan mas que los hashtags. Escribi las primeras 2 oraciones pensando en que buscaria tu audiencia.

### 4. Outlier Analysis
No analizar TODOS los videos de un competidor. Solo los que tuvieron performance 2-3x por encima de su promedio. Esos son los que tienen algo especial para replicar.

### 5. Build in Public
Mostrar lo que construis/haces es mas poderoso que dar tips genericos. La gente sigue personas, no cuentas de tips.

### 6. Reels para reach, Carousels para follows
Los reels te traen gente nueva (reach). Los carousels convierten visitantes en seguidores (saves + shares). Necesitas ambos.

### 7. Los primeros 6 posts son tu landing page
Cuando alguien visita tu perfil, mira los ultimos 6 posts. Si son buenos, te sigue. Si no, se va. Tus ultimos 6 posts deben ser tu mejor contenido.

---

## Estructura de archivos recomendada

```
~/.claude/commands/
  reel.md           # Skill de analisis de reels
  youtube.md        # Skill de extraccion YouTube
  engine.md         # Motor de contenido principal
  analysis.md       # Investigacion profunda (opcional)
  scout.md          # Analisis de cuentas competidoras (opcional)
  content.md        # Gestion del CRM de contenido (opcional)
```

---

## FAQ

### Cuantos tokens consume por ciclo?
Un `/engine` completo usa ~100-200K tokens (equivale a ~$0.50-1.50 USD por ciclo). Cada 2 dias = ~$10-20/mes.

### Puedo usarlo para multiples cuentas?
Si. El `/engine` acepta parametros para diferentes cuentas. Configura pilares separados para cada una.

### Funciona para cualquier idioma?
Si. Whisper transcribe en 98+ idiomas. Adapta el tono en el engine a tu idioma.

### Necesito una computadora potente?
No para el engine (corre en la nube de Claude). Si para Whisper local (transcripcion de audio). Si tu PC es lenta, usa el modelo "tiny" de Whisper en vez de "small".

### Puedo automatizarlo para que corra solo?
Si, con la skill `/schedule` de Claude Code podes programar que `/engine` corra cada 2 dias automaticamente.

---

## Creditos

Sistema diseñado y construido por Facundo Becker usando Claude Code (Opus 4.6).
Basado en frameworks de: Alex Hormozi (content model), Gary Vee (repurposing pipeline), Later/Socialinsider (data), y analisis propio de 25+ cuentas de referencia.
