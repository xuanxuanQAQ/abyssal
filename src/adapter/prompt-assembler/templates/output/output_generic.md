## Output Format

Output your analysis as a **JSON object**. Do NOT wrap it in markdown code fences or any other markup.

### JSON Schema

```json
{
  "summary": "200-300 word summary of the paper",
  "analysis_markdown": "Full analysis in Markdown format",
  "concept_mappings": [],
  "suggested_new_concepts": [
    {
      "term": "concept name",
      "frequency_in_paper": 12,
      "closest_existing": null,
      "reason": "Why this concept matters",
      "suggested_definition": "Working definition based on paper usage",
      "suggested_keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}
```

Note: `concept_mappings` must always be an empty array in exploratory mode — there is no framework to map against.

The `analysis_markdown` field should contain your detailed analysis with these sections:
1. **Summary** (200-300 words)
2. **Key Arguments**
3. **Methodological Assessment**
4. **Critical Evaluation**
5. **Concept Discovery Notes** — additional notes on identified concepts, their relationships, and potential significance
