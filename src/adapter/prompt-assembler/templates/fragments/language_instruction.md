## Language Requirements

**CRITICAL LANGUAGE ISOLATION:** The ENTIRE YAML frontmatter block (including all keys, enum values, and ALL text inside `evidence.en` fields) MUST BE STRICTLY IN ENGLISH. The `evidence.original` field uses the paper's source language. Only the final Markdown body text BELOW the closing `---` marker should be written in {output_language}. Violating this boundary will cause system parsing failures.

- YAML frontmatter field names and enum values: always English.
- YAML string values (evidence.en, claims, reasons): always English.
- `evidence.original`: In the paper's source language (may be non-English).
- Markdown body (analysis text): write in {output_language}.
- Concept names in Markdown body: use bilingual format "{name_zh} ({name_en})".
- When writing in Chinese about English-language papers, preserve key technical terms in English with Chinese annotation on first occurrence. Example: "可供性 (affordance) 理论..."
