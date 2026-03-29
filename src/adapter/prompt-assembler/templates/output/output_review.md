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
suggested_new_concepts:
  - term: "concept_name"
    frequency_in_paper: 5
    closest_existing: "related_concept_id"
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

### Complete Example

```yaml
---
paper_id: "{paper_id}"
paper_type: "review"
concept_mappings:
  - concept_id: "social_presence"
    relation: "supports"
    confidence: 0.90
    evidence:
      en: "The review identifies social presence as the most consistently studied construct across 85 VR studies, with strong evidence for its mediating role in collaborative outcomes"
      original: "The review identifies social presence as the most consistently studied construct..."
      original_lang: "en"
review_scope:
  topic: "Social dynamics in collaborative virtual environments"
  time_range: "2015-2024"
  paper_count: 85
taxonomy:
  - category: "Avatar-mediated interaction"
    description: "Studies examining how avatar properties affect social outcomes"
    representative_works:
      - "Bailenson (2018) — Experience on Demand"
      - "Latoschik et al. (2017) — Effect of avatar realism"
consensus_findings:
  - finding: "Behavioral realism contributes more to social presence than visual fidelity"
    strength_of_evidence: "strong"
    n_supporting_studies: 12
open_debates:
  - topic: "Measurement of social presence"
    position_a: "Self-report scales capture the construct adequately"
    position_b: "Physiological and behavioral measures are needed"
identified_gaps:
  - gap_description: "Long-term social presence effects beyond single sessions"
    relevance_to_framework: "Critical for understanding sustained virtual collaboration"
bibliography_mining:
  - title: "Oh et al. (2023) — Systematic Review of Social Presence in XR"
    reason: "Most comprehensive recent review; foundational reference for social_presence concept"
---
```
