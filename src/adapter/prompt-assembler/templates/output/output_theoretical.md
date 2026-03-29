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
suggested_new_concepts:
  - term: "concept_name"
    frequency_in_paper: 5
    closest_existing: "related_concept_id"
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

### Complete Example

```yaml
---
paper_id: "{paper_id}"
paper_type: "theoretical"
concept_mappings:
  - concept_id: "affordance"
    relation: "extends"
    confidence: 0.80
    evidence:
      en: "Gibson's ecological affordance framework is reinterpreted through a design lens, arguing that perceived affordances are culturally mediated rather than directly specified by the environment"
      original: "Gibson's ecological affordance framework is reinterpreted through a design lens..."
      original_lang: "en"
suggested_new_concepts:
  - term: "design_affordance"
    frequency_in_paper: 18
    closest_existing: "affordance"
    reason: "Proposed as a distinct construct from ecological affordance, emphasizing designer intent"
core_argument:
  thesis: "Affordances in designed artifacts are fundamentally different from ecological affordances because they embed designer intentionality"
  premises:
    - "Ecological affordances are observer-relative but not designer-intended"
    - "Designed artifacts carry normative expectations about use"
    - "Users perceive both ecological and designed affordances simultaneously"
  conclusion: "A dual-affordance model is needed that accounts for both ecological perception and cultural convention"
key_concepts:
  - term: "design affordance"
    definition: "An affordance that is intentionally created by a designer to suggest a specific mode of interaction"
    novelty: "refinement"
known_criticisms:
  - critic: "Chemero (2003)"
    criticism: "Affordances cannot be decomposed into ecological and designed components without losing explanatory power"
    severity: "significant"
internal_tensions:
  - "The paper claims affordances are culturally mediated but uses cross-cultural examples that suggest universal perception patterns"
---
```
