# Contributing to iKnowAPDF

Check the [open issues](https://github.com/YassineKIB123/iknowapdf/issues) for existing reports and the [good first issues](https://github.com/YassineKIB123/iknowapdf/labels/good%20first%20issue) for small changes. For a new tool or a larger change, open an issue first so we can agree on scope before you start.

## Run the project locally

Use Node.js 22 to match GitHub Actions. Clone the repo, then run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and go to the tool you’re working on. Before opening a pull request, run `npm run lint` and `npm run build`. For a tool change, try the affected workflow in a browser and check the exported file.

## Report a bug

Include the tool URL, your browser and device, the steps to reproduce the problem, what happened, and what you expected. If the problem depends on a file, attach a synthetic example you can share publicly or describe what makes it fail. Keep private documents and personal information out of issues and pull requests.

Report security and privacy vulnerabilities using the [security policy](SECURITY.md).

## Open a pull request

Keep the change focused. Link the related issue where possible and say how you verified the result. Keep document processing in the browser, including previews and exports. User files and their contents must stay on the device.

Everyone who participates is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
