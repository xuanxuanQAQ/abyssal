## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body containing your detailed analysis.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "journal" | "conference" | "theoretical" | "review" | ...
concept_mappings: []    # Always empty in exploratory mode
suggested_new_concepts:
  - term: "concept name"
    frequency_in_paper: 12
    reason: "Why this concept matters"
    suggested_definition: "Working definition based on paper usage"
    suggested_keywords: ["keyword1", "keyword2", "keyword3"]
    closest_existing: "related_known_concept"  # or null
  # ... identify 3-5 key concepts
core_claims:
  - claim: "One sentence"
    evidence_type: "empirical"
    strength: "moderate"
---
```

### Markdown Body Structure

After the YAML frontmatter, write your analysis with these sections:
1. **Summary** (200-300 words)
2. **Key Arguments**
3. **Methodological Assessment**
4. **Critical Evaluation**
5. **Concept Discovery Notes** — additional notes on identified concepts, their relationships, and potential significance
