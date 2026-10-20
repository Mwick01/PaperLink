# Contributing to PaperLink

Thank you for your interest in contributing to **PaperLink**! 🎓

PaperLink is a desktop application designed to make working with past papers easier by organizing, searching, and connecting educational resources with AI/MCP-based tools.

Contributions of all kinds are welcome — whether you're fixing a bug, improving the UI, suggesting a feature, improving documentation, or helping test the app.

## Ways You Can Contribute

You can help PaperLink by:

- Reporting bugs
- Suggesting new features
- Improving the user interface or user experience
- Fixing existing issues
- Improving performance
- Improving documentation
- Testing releases
- Improving accessibility
- Refactoring or cleaning up code

Even small contributions are appreciated.

## Before You Start

Before working on a change:

1. Check the existing **Issues** to see whether the problem or feature has already been discussed.
2. For larger features or major architectural changes, please open an issue first so the idea can be discussed before significant development work begins.
3. For small bug fixes, documentation improvements, or minor UI fixes, feel free to open a pull request directly.

## Development Setup

### Requirements

Make sure you have the tools required by the PaperLink project installed.

PaperLink uses technologies including:

- Tauri
- Rust
- Web frontend technologies
- Node.js / npm

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/PaperLink.git
cd PaperLink
```

Install frontend dependencies:

```bash
npm install
```

Run the application in development mode:

```bash
npm run tauri dev
```

Depending on your operating system, Tauri may require additional system dependencies.

See the official Tauri setup documentation if you encounter environment-related build errors.

## Creating a Branch

Create a separate branch for your change.

Examples:

```bash
git checkout -b fix/import-error
```

```bash
git checkout -b feature/search-improvements
```

```bash
git checkout -b docs/update-readme
```

Try to use descriptive branch names.

## Making Changes

When contributing code:

- Keep changes focused on one issue or feature where possible.
- Follow the existing project structure and coding style.
- Avoid unnecessary dependencies.
- Remove unused code and debug output.
- Keep the UI consistent with the existing PaperLink design.
- Consider how changes affect Windows and other supported platforms.
- Do not commit API keys, passwords, tokens, credentials, or private data.

For user-facing changes, screenshots or short recordings are very helpful.

## Commit Messages

Use short and descriptive commit messages.

Examples:

```text
fix: prevent duplicate paper imports
```

```text
feat: add filtering to paper search
```

```text
ui: improve sidebar spacing
```

```text
docs: update development setup
```

You do not need to follow a strict commit convention, but clear commit messages make the project easier to maintain.

## Testing

Before submitting your pull request:

- Run the application locally.
- Test the feature or bug fix you changed.
- Make sure existing functionality still works.
- Check for console or build errors.
- Run any available tests or linting tools.

For build-related changes, verify that the application can still compile successfully.

## Pull Requests

When opening a pull request, include:

- A clear title
- A short explanation of what changed
- Why the change was needed
- Any related issue number
- Screenshots for visual changes, when appropriate
- Steps for testing the change, if necessary

Example:

```text
Fixes #42

This PR fixes an issue where cancelling a paper import could leave
the import state stuck.

Changes:
- Reset import state after cancellation
- Improved cancellation error handling
- Added UI feedback when an import is cancelled
```

Please keep unrelated changes out of the same pull request whenever possible.

## Bug Reports

When reporting a bug, please include as much relevant information as possible:

- PaperLink version
- Operating system
- What you expected to happen
- What actually happened
- Steps to reproduce the issue
- Screenshots or logs, if available

Please remove personal information, API keys, file paths containing sensitive information, and other private data before sharing logs.

## Feature Requests

Feature ideas are welcome.

A useful feature request explains:

- What problem the feature solves
- Who would benefit from it
- How you imagine it working
- Any alternatives you have considered

You do not need to provide a technical implementation.

## AI-Generated Contributions

AI-assisted development tools are welcome, but contributors remain responsible for the code they submit.

If you use AI-generated code:

- Review it before submitting.
- Understand what the code does.
- Test it.
- Make sure it does not introduce security vulnerabilities.
- Make sure it does not include incompatible copyrighted code or licenses.
- Do not submit large generated changes without reviewing them.

The contributor submitting the pull request is responsible for the final contribution.

## Security Issues

Please do not publicly disclose serious security vulnerabilities before maintainers have had an opportunity to investigate them.

If a private security reporting method is available through GitHub Security Advisories, please use it.

## Community

Please be respectful when communicating with contributors and users.

By participating in the PaperLink project, you agree to follow the project's `CODE_OF_CONDUCT.md`.

## License

By contributing to PaperLink, you agree that your contributions may be distributed under the same license as the project.

## Questions

If you're unsure about something, feel free to open an issue or discussion.

You don't need to be an experienced open-source contributor to help.

Thanks for helping improve PaperLink. ❤️
