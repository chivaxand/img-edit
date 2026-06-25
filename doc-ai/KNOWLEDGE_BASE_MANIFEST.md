# Knowledge Base Manifest

This directory serves as the architectural source of truth designed specifically for both human developers and Large Language Models (LLMs) / AI Agents. 

The primary objective of this Knowledge Base (KB) is to preserve institutional memory, document strict project patterns, prevent recurring defects, and provide exact context to AI assistants to ensure generated code adheres strictly to the current architecture.

## Core Objectives

1. **Contextual Accuracy:** Prevent AI agents and developers from defaulting to standard library solutions when custom project wrappers, internal frameworks, or specific architectural patterns are required.
2. **Contextual Retrieval:** Enforce a strict tagging and metadata system enabling accurate RAG (Retrieval-Augmented Generation) and precise developer search.
3. **Single Source of Truth:** Code should not be duplicated, but the *reasoning* and *rules* behind the code must live here. 
4. **Continuous Evolution:** Ensure the KB remains a living entity. Any new architectural decision, edge-case resolution, or undocumented pattern must result in the creation or modification of a KB document.

---

## Structure & Naming Conventions

To maintain a clean and easily parsable file tree, a **flat directory structure** is used. All documentation files must live directly in the root of the `doc-ai` folder. 

To maintain organization, the following prefix-based naming convention is strictly enforced:

*   **File Naming:** Use strictly lowercase `kebab-case.md` with a **category prefix** (e.g., `architecture-dependency-injection.md`, `ui-button-component.md`).

### Required Category Prefixes
*   `arch-*` - High-level structural rules, design patterns, and state/event management.
*   `core-*` - Global utilities, standard formatting, and base application setup.
*   `data-*` - Storage paradigms, persistence, history stacks, and data structures.
*   `net-*` - API communication layers, payload formatting, and request templates.
*   `ui-*` - View components, custom DOM builders, layout systems, and styling guidelines.
*   `feature-*` - Domain-specific business logic (e.g., filters, tools, layer systems).
*   `tooling-*` - Build scripts, local environment configurations, and workflow tools.
*   `testing-*` - Unit/integration/e2e testing conventions and mocking strategies.

---

## Document Metadata (Strict Requirement)

Regardless of content, **every markdown file** within this KB must strictly begin with a YAML metadata block. This powers search functionality and AI context mapping.

```yaml
---
title: Short, descriptive title
tags: ["domain", "specific_entity", "concept", "symptom"]
---
```

### Tagging Strategy
Typical tags count around 5-10. Tags must be lowercase and include a mix of the following types to ensure accurate retrieval:
*   **Domain Tags:** General area (e.g., `networking`, `storage`, `ui`, `auth`).
*   **Entity Tags:** Exact class, protocol, library, or module names relevant to the file.
*   **Concept Tags:** Underlying principles (e.g., `dependency injection`, `mocking`, `migration`).
*   **Symptom/Problem Tags:** Associated observable issues (e.g., `deadlock`, `crash`, `memory leak`).

---

## Document Archetypes and Body Structure

There is no single template for the body of a KB file. The structure must be chosen based on the archetype of the information being documented. When creating a new file, follow the structure that best fits the subject:

### 1. Implementation Templates & Patterns
Used for standardized, repetitive tasks (e.g., creating a network request, writing a new component, or a database repository).
*   **Required Sections:** "Architecture/Rules", "Implementation Template" (copy-pasteable code block).

### 2. Problem Resolution & Anti-Patterns
Used to document severe bugs, system limitations, or complex migration constraints.
*   **Required Sections:** "The Anti-Pattern" (what causes the issue/bad example), "Root Cause", "The Solution" (with good code examples).

### 3. Feature & Logic Deep Dives
Used for complex state management, data flows, or multi-threaded operations.
*   **Required Sections:** "Core Concepts", "Data Flow Pipeline / Lifecycle", "State Markers". Code snippets are secondary to architectural explanations.

### 4. API References & Cheat Sheets
Used for custom wrappers or extensive utility classes.
*   **Required Sections:** Categorized lists or tables detailing method signatures, parameters, and expected behaviors.

### 5. Processes & Tooling
Used for build scripts, CI/CD pipelines, code generation, and debug environments.
*   **Required Sections:** "How it Works", "Terminal Commands / Usage Instructions", "How to Extend".

---

## Triggers for Updating the KB

Developers and AI agents should propose a new file or update an existing one when:
1. A new global utility, custom UI component, or wrapper is created.
2. A recurring bug is solved that requires a specific architectural workaround.
3. A new third-party library is integrated, establishing a new pattern for how the project interacts with it.
4. A migration between an old technology and a new technology is initiated.

---

## Directives for LLMs and AI Agents

If an AI system or LLM is reading this manifest as part of its system prompt or context window, it must operate under the following absolute constraints:

1. **Prioritize Local Context:** Before writing or modifying code, consult the KB files provided in the prompt. If the project utilizes a custom layer (e.g., custom network clients, internal UI frameworks, or specific data wrappers), you are **strictly forbidden** from bypassing them in favor of standard language libraries or frameworks unless explicitly instructed otherwise.
2. **Adhere to Templates:** When generating boilerplate, creating requests, implementing repositories, or writing unit tests, you must replicate the exact structural templates provided in the KB.
3. **Respect Migration Patterns:** If the documentation specifies a bridging pattern between legacy and modern codebases, implement the required bridging logic. Do not attempt to rewrite the legacy system entirely unless refactoring is the explicit goal of the prompt.
4. **Be Concise and Direct:** When generating KB documentation, avoid conversational fluff. Use clear headings, bullet points, and highlight critical rules in bold.
5. **Knowledge Base Maintenance:** When instructed to create or update a KB file based on a newly completed task, analyze the nature of the task, select the correct Document Archetype defined above, ensure the YAML frontmatter is present, and use the `[category-prefix]-[topic].md` flat file naming convention.
6. **Do Not Auto-Update Documentation:** Completion of implementation tasks, bug fixes, migrations, or architectural changes does NOT imply permission to update the Knowledge Base. AI agents must wait for a direct user request before generating, modifying, or proposing KB documentation changes.