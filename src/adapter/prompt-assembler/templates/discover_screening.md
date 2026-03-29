## Task: Relevance Screening

Assess whether the following paper is relevant to the research project described below. This is a quick screening — not a deep analysis.

### Research Project

Description: {project_description}

{concept_framework}

### Paper to Screen

- **Title**: {paper_title}
- **Authors**: {paper_authors}
- **Year**: {paper_year}
- **Venue**: {paper_venue}
- **Abstract**: {paper_abstract}

### Assessment

Based ONLY on the title, authors, venue, and abstract (not full text), provide:

1. **relevance_score**: 0.0 to 1.0
   - 0.8-1.0: Directly relevant — addresses core concepts or methods.
   - 0.5-0.7: Moderately relevant — related topic or methodology.
   - 0.2-0.4: Tangentially relevant — shares some themes.
   - 0.0-0.1: Not relevant.

2. **relevance_rationale**: One sentence explaining WHY (≤100 words).

3. **paper_type_hint**: empirical / theoretical / review / unknown

4. **key_concepts_detected**: List of concept IDs from the framework that this paper likely relates to (can be empty).

Output as a JSON object:

```json
{
  "relevance_score": 0.75,
  "relevance_rationale": "...",
  "paper_type_hint": "empirical",
  "key_concepts_detected": ["theory_of_mind", "affordance"]
}
```
