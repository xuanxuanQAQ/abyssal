## Output Format

Output your analysis as a **JSON object**. Do NOT wrap it in markdown code fences or any other markup.

### JSON Schema

```json
{
  "summary": "200-300 word summary of the source",
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
1. **Source Assessment** — author type, document type, credibility, bias indicators
2. **Core Claims** — assertions with evidence basis (data-backed/expert-cited/regulation-based/anecdotal/assertion-only)
3. **Concept Mapping Rationale** — why each mapping was assigned
4. **Practical Implications** — stakeholder impacts
5. **Temporal Relevance** — key dates and time sensitivity
