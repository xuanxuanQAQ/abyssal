## Output Format

Output your analysis as a **JSON object**. Do NOT wrap it in markdown code fences or any other markup.

### JSON Schema

```json
{
  "summary": "200-300 word summary of the review",
  "analysis_markdown": "Full analysis in Markdown format",
  "concept_mappings": [
    {
      "concept_id": "concept_identifier",
      "relation": "supports | challenges | extends | operationalizes | irrelevant",
      "confidence": 0.75,
      "evidence": {
        "en": "English evidence text",
        "original": "Original language text",
        "original_lang": "en",
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
1. **Review Scope** — topic, time range, paper count
2. **Taxonomy** — categories with descriptions and representative works
3. **Consensus Findings** — what the literature agrees on, with strength of evidence
4. **Open Debates** — active disagreements with opposing positions
5. **Identified Gaps** — underexplored research questions and their relevance to the framework
6. **Bibliography Mining** — notable papers worth tracking
