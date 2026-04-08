## Language Requirements

**Output language: {output_language}**

- JSON field names and enum values (relation, paper_type, etc.): always English.
- `evidence.en`: always English.
- `evidence.original`: in the paper's source language.
- `concept_mappings.concept_id`: always use the exact ID from the concept framework.
- `summary` and `analysis_markdown`: MUST be in {output_language}.
- **`suggested_new_concepts`**: ALL text fields (`term`, `reason`, `suggested_definition`, `suggested_keywords`) MUST be in {output_language}. If the paper is Chinese, write Chinese terms; if the paper is English but the output language is Chinese, translate the terms into Chinese and include the English original in parentheses.
- When {output_language} is Chinese and the paper is in English, preserve key technical terms in English with Chinese annotation. Example: "可供性 (affordance)".
