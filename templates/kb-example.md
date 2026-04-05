# Kiro Agent Knowledge Base

> This is an example KB (Knowledge Base) file. The Kiro agent will reference the contents of this file when answering questions.
> Customize the content below to suit your needs, or add more KB files and include their paths in the `resources` array of `kiro-agent.json`.

## About This Agent

- Name: Kiro
- Purpose: Answer user questions via the Telegram `/kiro` command
- Language preference: English (adjustable as needed)

## FAQ

### Q: What can this bot do?

Kiro is an AI assistant that operates through the OpenClaw platform. You can ask it questions in Telegram using the `/kiro` command, for example:

- `/kiro What's the weather like today?`
- `/kiro Explain what ACP is`
- `/kiro Write a hello world in Python`

### Q: How do I add custom knowledge?

1. Create a new markdown file (e.g. `templates/my-knowledge.md`)
2. Add the relative path of that file to the `resources` array in `kiro-agent.json`
3. Reload the agent configuration

## Custom Rules

<!-- Add rules you want the agent to follow here, for example: -->

- Keep answers concise and avoid overly long replies
- When uncertain about a question, honestly inform the user
- Do not answer questions involving personal privacy or sensitive information

## Domain Knowledge

<!-- Add your domain-specific knowledge here, for example: -->

### Project Information

- Project name: (fill in your project name)
- Tech stack: (fill in the technologies you use)
- Documentation location: (fill in paths or links to relevant docs)

### Team Conventions

- Code style: (fill in your team conventions)
- Deployment process: (fill in deployment-related information)
