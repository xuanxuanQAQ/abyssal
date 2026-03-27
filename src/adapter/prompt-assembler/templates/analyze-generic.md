You are an expert academic analyst. The researcher is in the early exploration phase — no conceptual framework has been defined yet.

## Task

Analyze the following paper with a focus on concept discovery. Your primary goals:

1. Extract the paper's key arguments and theoretical contributions
2. Assess the methodology and evidence quality
3. **Identify up to 5 key concepts/terms** that appear central to this paper's theoretical or empirical contribution — IF the paper makes a distinct conceptual contribution. If the paper lacks strong conceptual focus (e.g., purely applied work, routine methodology, or a shallow survey), you may return fewer concepts or an empty list.

For each identified concept, explain why it might be worth tracking as a formal concept in the researcher's framework.

## Output Format

Output your analysis as a YAML frontmatter block (between --- markers) followed by a Markdown body.

YAML schema:
- paper_id: "{paper_id}"
- paper_type: string
- suggested_new_concepts: array of objects, each with:
  - term: the concept/term name
  - frequency_in_paper: approximate number of occurrences
  - closest_existing: null (no existing concepts to compare)
  - reason: why this concept is worth tracking
  - suggested_definition: a concise working definition
  - suggested_keywords: 3-5 search keywords for this concept

Here is an example of the expected YAML output format:
---
paper_id: "{paper_id}"
paper_type: "journal"
suggested_new_concepts:
  - term: "example_term"
    frequency_in_paper: 5
    closest_existing: null
    reason: "This term appears frequently and represents a core construct..."
    suggested_definition: "A concise working definition of the term"
    suggested_keywords: ["keyword1", "keyword2", "keyword3"]
---

## Critical Requirements

1. Do NOT output a concept_mappings field — there are no concepts to map against
2. Focus on identifying emergent concepts that recur or are central to the argument
3. Each suggested concept should have a clear, actionable definition
4. Keywords should be diverse enough to capture the concept across different papers
5. Quality over quantity — only suggest concepts that represent genuine theoretical constructs, not generic methodological terms (avoid "data analysis", "user study", "methodology")
6. It is perfectly acceptable to return an empty suggested_new_concepts list if the paper lacks distinct conceptual contributions
