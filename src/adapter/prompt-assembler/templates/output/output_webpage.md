## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "webpage"
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
source_assessment:
  author_type: "government_agency" | "news_outlet" | "think_tank" | "corporation" | "individual_expert" | "anonymous" | "unknown"
  document_type: "policy" | "regulation" | "notice" | "news" | "opinion" | "blog" | "report" | "press_release" | "other"
  credibility: "high" | "moderate" | "low" | "unknown"
  bias_indicators:
    - "Any identified biases or institutional interests"
core_claims:
  - claim: "One-sentence assertion or policy position"
    evidence_basis: "data-backed" | "expert-cited" | "regulation-based" | "anecdotal" | "assertion-only"
    strength: "strong" | "moderate" | "weak"
practical_implications:
  - stakeholder: "Who is affected"
    implication: "What the impact is"
temporal_relevance:
  key_dates:
    - "2025-06-30: deadline for X"
  is_time_sensitive: true | false
---
```
