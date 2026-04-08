## Output Format

Output your analysis as a **JSON object**. Do NOT wrap it in markdown code fences or any other markup.

### JSON Schema

```json
{
  "summary": "200-300 word summary of the paper",
  "analysis_markdown": "Full analysis in Markdown format",
  "concept_mappings": [
    {
      "concept_id": "concept_identifier",
      "relation": "supports | challenges | extends | operationalizes | irrelevant",
      "confidence": 0.75,
      "evidence": {
        "en": "English evidence text",
        "original": "Original language text",
        "original_lang": "zh-CN",
        "chunk_id": null,
        "page": null,
        "annotation_id": null
      }
    }
  ],
  "suggested_new_concepts": [
    {
      "term": "concept_name",
      "frequency_in_paper": 5,
      "closest_existing": "related_concept_id or null",
      "reason": "Why this concept matters",
      "suggested_definition": null,
      "suggested_keywords": null
    }
  ]
}
```

The `analysis_markdown` field should contain your detailed analysis with these sections:
1. **Summary** — core claims and empirical findings
2. **Methodology** — design, sample, measures, validity concerns
3. **Concept Mapping Rationale** — why each mapping was assigned
4. **Limitations** — researcher-identified limitations (not self-reported)
