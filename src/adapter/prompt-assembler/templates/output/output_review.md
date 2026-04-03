## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "review"
concept_mappings:
  - concept_id: "concept_identifier"
    relation: "supports" | "challenges" | "extends" | "operationalizes" | "irrelevant"
    confidence: 0.75
    evidence:
      en: "English evidence text"
      original: "Original language text"
      original_lang: "en"
  # ... one entry per concept in the framework
suggested_new_concepts:
  - term: "concept_name"
    frequency_in_paper: 5
    closest_existing: "related_concept_id"  # or null
    reason: "Why this concept matters"
review_scope:
  topic: "What the review covers"
  time_range: "2010-2024"
  paper_count: 85
taxonomy:
  - category: "Category label"
    description: "What this category encompasses"
    representative_works:
      - "Author (Year) — Title"
consensus_findings:
  - finding: "What the literature agrees on"
    strength_of_evidence: "strong" | "moderate" | "weak"
    n_supporting_studies: 12
open_debates:
  - topic: "Active disagreement"
    position_a: "One side"
    position_b: "Other side"
identified_gaps:
  - gap_description: "Underexplored research question"
    relevance_to_framework: "How this gap relates to researcher's concepts"
bibliography_mining:
  - title: "Paper title worth tracking"
    reason: "Why it's relevant"
---
```
