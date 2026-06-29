```markdown
# free-swarm Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill provides a comprehensive guide to developing within the `free-swarm` repository, a Python and Next.js monorepo designed for cloud-native, multi-app deployments (e.g., Vercel). It covers coding conventions, file organization, and detailed workflows for common tasks such as monorepo restructuring, API endpoint development, frontend feature extension, OAuth integration, rebranding, and build pipeline optimization. The guide is intended for contributors seeking to maintain consistency and efficiency across the codebase.

---

## Coding Conventions

**File Naming**
- Use `camelCase` for file and directory names.
  - Example: `userSettings.tsx`, `apiHandler.ts`

**Imports**
- Prefer **relative imports** within modules.
  - Example:
    ```js
    import userReducer from './userReducer'
    import { fetchData } from '../lib/api'
    ```

**Exports**
- Use **default exports** for modules and components.
  - Example:
    ```js
    // Good
    export default function SettingsPage() { ... }

    // Avoid
    export { SettingsPage }
    ```

**Commit Messages**
- Freeform style, sometimes with prefixes.
- Average length: ~57 characters.
  - Example: `Add Google OAuth provider and update settings UI`

---

## Workflows

### Monorepo Deployment Restructure

**Trigger:** When consolidating multiple apps into a single deployable monorepo for cloud hosting (e.g., Vercel).  
**Command:** `/monorepo-restructure`

1. Move or reorganize project directories (e.g., move `website/` to root, keep `frontend/` as `/app`).
2. Update or create root-level build scripts in `package.json` to build all subprojects.
3. Update `vercel.json` to handle new routing and rewrites for each app.
4. Update or add configuration files (`next.config.js`, `tailwind.config.js`, `tsconfig.json`) at the root.
5. Remove or archive old subproject directories as needed.

**Example:**
```json
// vercel.json
{
  "rewrites": [
    { "source": "/app/(.*)", "destination": "/frontend/$1" }
  ]
}
```

---

### Cloud API Endpoint Implementation

**Trigger:** When implementing new cloud-side features or integrating new OAuth/billing providers.  
**Command:** `/new-cloud-api-endpoint`

1. Add or update endpoint handler file in `cloud/api/`.
2. Add or update supporting logic in `cloud/lib/`.
3. Update `cloud/README.md` and `.env.example` for new env vars or documentation.
4. Update `cloud/db/schema.sql` if new tables or fields are needed.
5. Update `cloud/package.json` for new dependencies.
6. Test with `tsc` and at runtime.

**Example:**
```ts
// cloud/api/auth/google.ts
import { handleGoogleAuth } from '../lib/googleAuth'
export default async function handler(req, res) {
  // ...
}
```

---

### Frontend Settings Feature Extension

**Trigger:** When adding a new configurable feature or option in the Settings area.  
**Command:** `/new-settings-feature`

1. Create or update React component(s) in `frontend/src/app/pages/Settings/sections/`.
2. Update or add Redux state logic in `frontend/src/shared/state/settingsSlice.ts`.
3. Integrate new component into the relevant Settings tab/page.
4. Update backend handler if new API routes or logic are required.
5. Test UI and state changes.

**Example:**
```tsx
// frontend/src/app/pages/Settings/sections/ModelCombo.tsx
export default function ModelCombo() { ... }
```

---

### OAuth Provider Integration

**Trigger:** When adding support for a new OAuth provider for user sign-in or account connection.  
**Command:** `/add-oauth-provider`

1. Add or update `cloud/api/auth/{provider}.ts` endpoint.
2. Update `cloud/.env.example` and `README.md` for new provider credentials.
3. Update frontend UI (e.g., add sign-in/connect button in `AccountCard.tsx`).
4. Update OAuth redirect and token handoff logic as needed.
5. Test the full OAuth flow (web and desktop).

**Example:**
```tsx
// frontend/src/app/pages/Settings/sections/subscription/AccountCard.tsx
<button onClick={handleGoogleConnect}>Connect Google</button>
```

---

### Branding or Rebranding Sweep

**Trigger:** When renaming the product, organization, or major domain references across all code, docs, and configs.  
**Command:** `/rebrand`

1. Bulk search/replace across all files for old brand/product/org names.
2. Update `README.md`, `GETTING_STARTED.md`, and other docs.
3. Update assets (icons, screenshots, etc.) as needed.
4. Update deployment configs (`vercel.json`, `index.html`, `package.json`).
5. Audit for missed references and document in a report.

---

### Build Pipeline Fix or Optimization

**Trigger:** When builds fail or need optimization for deployment (e.g., asset paths, dependency resolution, cache busting).  
**Command:** `/fix-build-pipeline`

1. Update build scripts in `package.json` (root or subproject).
2. Update `webpack.config.js` or `next.config.js` as needed.
3. Update `.gitignore` to add/remove build artifacts.
4. Update `vercel.json` for `buildCommand` or rewrites.
5. Test build locally and/or on Vercel.

**Example:**
```js
// next.config.js
module.exports = {
  assetPrefix: process.env.ASSET_PREFIX || '',
}
```

---

## Testing Patterns

- **Framework:** Jest
- **Test file pattern:** `*.spec.ts`
- **Typical location:** Near the code under test or in dedicated `__tests__` directories.

**Example:**
```ts
// frontend/src/shared/state/settingsSlice.spec.ts
import settingsReducer from './settingsSlice'

test('should handle initial state', () => {
  expect(settingsReducer(undefined, { type: 'unknown' })).toEqual({ ... })
})
```

---

## Commands

| Command                | Purpose                                                         |
|------------------------|-----------------------------------------------------------------|
| /monorepo-restructure  | Restructure repository for unified monorepo deployment          |
| /new-cloud-api-endpoint| Add or update a cloud API endpoint and related logic            |
| /new-settings-feature  | Add or extend a frontend Settings UI feature                    |
| /add-oauth-provider    | Integrate a new OAuth provider for authentication               |
| /rebrand               | Perform a comprehensive rebranding sweep                        |
| /fix-build-pipeline    | Fix or optimize the build pipeline for deployment               |
```
