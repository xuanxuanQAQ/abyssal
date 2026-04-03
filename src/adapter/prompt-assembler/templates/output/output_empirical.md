## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "journal" | "conference" | "preprint" | "unknown"
concept_mappings:
  - concept_id: "concept_identifier"
    relation: "supports" | "challenges" | "extends" | "operationalizes" | "irrelevant"
    confidence: 0.75
    evidence:
      en: "English evidence text"
      original: "Original language text"
      original_lang: "zh-CN"
  # ... one entry per concept in the framework
suggested_new_concepts:
  - term: "concept_name"
    frequency_in_paper: 5
    closest_existing: "related_concept_id"  # or null
    reason: "Why this concept matters"
core_claims:
  - claim: "One-sentence finding"
    evidence_type: "experimental" | "correlational" | "observational" | "computational" | "mixed"
    strength: "strong" | "moderate" | "weak"
methodology:
  design: "Research design description"
  sample: "N=120 university students, convenience sampling"
  measures: "Key instruments"
  validity_concerns: "Threats to validity"
limitations:
  - "First limitation you identify"
  - "Second limitation you identify"
---
```
