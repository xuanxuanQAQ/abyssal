## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

### YAML Schema

```yaml
---
paper_id: "{paper_id}"
paper_type: "theoretical" | "book" | "chapter"
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
core_argument:
  thesis: "Central theoretical claim (1-2 sentences)"
  premises:
    - "Key premise 1"
    - "Key premise 2"
  conclusion: "What the argument establishes"
key_concepts:
  - term: "concept as paper uses it"
    definition: "Paper's definition"
    novelty: "original" | "refinement" | "synthesis" | "application"
known_criticisms:
  - critic: "Name or citation"
    criticism: "Substance of critique"
    severity: "fatal" | "significant" | "minor"
internal_tensions:
  - "Logical tension or unresolved contradiction within the paper"
---
```
