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
core_claims:
  - claim: "One sentence"
    evidence_type: "empirical"
    strength: "moderate"
---
```

### Complete Example

```yaml
---
paper_id: "a1b2c3d4e5f6"
paper_type: "journal"
concept_mappings: []
suggested_new_concepts:
  - term: "social presence"
    frequency_in_paper: 23
    reason: >
      The paper treats social presence as a measurable construct distinct
      from copresence, arguing it mediates trust formation in virtual
      environments
    suggested_definition: >
      The subjective sense of being with another person in a mediated
      environment, measured through perceived awareness and mutual attention
    suggested_keywords: ["social presence", "copresence", "telepresence", "mediated communication", "virtual togetherness"]
    closest_existing: "theory_of_mind"
  - term: "behavioral realism"
    frequency_in_paper: 15
    reason: >
      Introduced as a novel construct bridging appearance fidelity and
      behavioral fidelity in avatar design
    suggested_definition: >
      The degree to which a virtual agent's behaviors conform to
      expectations derived from its visual appearance
    suggested_keywords: ["behavioral realism", "avatar fidelity", "behavioral expectations", "appearance-behavior consistency"]
    closest_existing: null
core_claims:
  - claim: "Social presence in VR is primarily driven by behavioral cues rather than visual fidelity"
    evidence_type: "empirical"
    strength: "strong"
---
```

### Markdown Body Structure

After the YAML frontmatter, write your analysis with these sections:
1. **Summary** (200-300 words)
2. **Key Arguments**
3. **Methodological Assessment**
4. **Critical Evaluation**
5. **Concept Discovery Notes** — additional notes on identified concepts, their relationships, and potential significance
