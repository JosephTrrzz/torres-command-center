# Deploy to Cloudflare Pages

This Phase One build is configured as a static Next.js export, which is suitable for the dashboard and demo client pages.

## Cloudflare Pages settings

In Cloudflare Pages, choose **Create a project → Connect to Git** and select the GitHub repository.

- Framework preset: `Next.js (Static HTML Export)`
- Build command: `npm run build`
- Build output directory: `out`
- Root directory: `/`

Cloudflare will redeploy automatically when changes are pushed to the connected GitHub branch.

## Custom domain

After the first successful deployment, open the Pages project and choose **Custom domains → Set up a custom domain**. Use the domain or subdomain you want for the Command Center. If the domain is already managed inside Cloudflare, the DNS record can be added automatically. Otherwise, Cloudflare will show the DNS record to add at your current DNS provider.

This static export is intentional for Phase One. When authentication, a database, and live Google/Cloudflare integrations are added, the hosting configuration should move to a Cloudflare-compatible Next.js runtime rather than remaining a static export.
