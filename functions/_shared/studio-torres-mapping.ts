// Reviewed static targets only. No selectors or source identities come from drafts.
// Source fixtures retain the exact Git blobs used for this mapping; tests bind
// numeric/context identities to the imported snapshot and static source JSX.
export const TORRES_SOURCE_COMMIT = '62a0b0539cf0ea232dcc9eb02c3837928efb7d5c';
export const TORRES_MAPPING_SNAPSHOT = 'b6262015e3786ff49fa48d8341c685e7194777f51780f6f56ef75ba1c94b324e';
export interface TorresTarget {
  id: string; page: string; route: string; nodeId: string | null; contextKey: string | null;
  selector: string; tag: string; kind: 'text' | 'image' | 'compound'; sourceFile: string; sourceBlob: string;
  expectedText?: string; expectedChildText?: string; childTarget?: string; expectedSrc?: string; snapshotSrc?: string; expectedAlt?: string; sectionSelector?: string;
}
export const TORRES_TARGETS: readonly TorresTarget[] = [
  {
    "id": "home-eyebrow",
    "page": "0",
    "route": "/",
    "nodeId": "1",
    "contextKey": "page:2.1.0",
    "selector": "main#home.homePage > section.hero.homeFullBleed > .heroCopy > p.eyebrow",
    "tag": "P",
    "sourceFile": "app/page.tsx",
    "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
    "kind": "text",
    "expectedText": "Independent expertise · Portland, Oregon"
  },
  {
    "id": "home-lion",
    "page": "0",
    "route": "/",
    "nodeId": "2",
    "contextKey": "page:2.1.1.0",
    "selector": "main#home.homePage > section.hero.homeFullBleed .heroLionBrand > img",
    "tag": "IMG",
    "sourceFile": "app/page.tsx",
    "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
    "kind": "image",
    "expectedSrc": "/images/torres-co-standing-lion-bronze.png",
    "snapshotSrc": "/website-preview/assets/635054cac5615fe61e1f.png",
    "expectedAlt": "Torres & Co. Technology",
    "sectionSelector": "main#home.homePage > section.hero.homeFullBleed"
  },
  {
    "id": "home-lead",
    "page": "0",
    "route": "/",
    "nodeId": "4",
    "contextKey": "page:2.1.3",
    "selector": "main#home.homePage > section.hero.homeFullBleed > .heroCopy > p.heroLead",
    "tag": "P",
    "sourceFile": "app/page.tsx",
    "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
    "kind": "text",
    "expectedText": "Websites, IT systems, and local search, shaped around your business. Work directly with the owner, from the first conversation to the details that follow."
  },
  {
    "id": "home-intro",
    "page": "0",
    "route": "/",
    "nodeId": "7",
    "contextKey": "page:4.1.1",
    "selector": "main#home.homePage > section.intro#services > div > p",
    "tag": "P",
    "sourceFile": "app/page.tsx",
    "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
    "kind": "text",
    "expectedText": "Website design, IT support, networking, and local SEO—with one accountable partner bringing the details together. Clear advice. Careful implementation. A person who knows your business."
  },
  {
    "id": "about-title",
    "page": "8",
    "route": "/about",
    "nodeId": "2",
    "contextKey": null,
    "selector": "main.aboutDetailPage > header.aboutHero > div > h1",
    "tag": "H1",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "text",
    "expectedText": "Modern technology, delivered with old-fashioned service."
  },
  {
    "id": "about-lead",
    "page": "8",
    "route": "/about",
    "nodeId": "3",
    "contextKey": null,
    "selector": "main.aboutDetailPage > header.aboutHero > div > p:not(.eyebrow)",
    "tag": "P",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "text",
    "expectedText": "Torres & Co. Technology is a locally operated technology company serving Portland-area small businesses and homes. Clients work directly with the owner from the first conversation through delivery and ongoing support."
  },
  {
    "id": "about-portrait",
    "page": "8",
    "route": "/about",
    "nodeId": "5",
    "contextKey": "page:3.0.0",
    "selector": "main.aboutDetailPage > section.pageBand > .aboutPageGrid > img",
    "tag": "IMG",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "image",
    "expectedSrc": "/images/residential-technology-portland.jpg",
    "snapshotSrc": "/website-preview/assets/3e282c994a7c8a0560b9.jpg",
    "expectedAlt": "Owner of Torres & Co. Technology in downtown Portland",
    "sectionSelector": "main.aboutDetailPage > section.pageBand"
  },
  {
    "id": "about-label",
    "page": "8",
    "route": "/about",
    "nodeId": "6",
    "contextKey": "page:3.0.1.0",
    "selector": "main.aboutDetailPage > section.pageBand > .aboutPageGrid > div > p.sectionLabel",
    "tag": "P",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "text",
    "expectedText": "The working relationship"
  },
  {
    "id": "about-relationship-title",
    "page": "8",
    "route": "/about",
    "nodeId": "7",
    "contextKey": "page:3.0.1.1",
    "selector": "main.aboutDetailPage > section.pageBand > .aboutPageGrid > div > h2",
    "tag": "H2",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "text",
    "expectedText": "Personal service is part of the technology."
  },
  {
    "id": "about-relationship-copy",
    "page": "8",
    "route": "/about",
    "nodeId": "8",
    "contextKey": "page:3.0.1.2",
    "selector": "main.aboutDetailPage > section.pageBand > .aboutPageGrid > div > p:not(.sectionLabel)",
    "tag": "P",
    "sourceFile": "app/about/page.tsx",
    "sourceBlob": "2298bb790f43219c586e9c26e357a728461904bd",
    "kind": "text",
    "expectedText": "Good technology work is not only about equipment or code. It is also about listening carefully, communicating clearly, taking responsibility, and leaving a client with systems they understand."
  },
  {
    "id": "contact-title",
    "page": "10",
    "route": "/contact",
    "nodeId": "2",
    "contextKey": null,
    "selector": "main.contactDetailPage > header.pageHero > h1",
    "tag": "H1",
    "sourceFile": "app/contact/page.tsx",
    "sourceBlob": "ce52238966b6086ec1c0822a47bb44b4f21d995b",
    "kind": "text",
    "expectedText": "Tell us what you need to solve, build, or improve."
  },
  {
    "id": "contact-lead",
    "page": "10",
    "route": "/contact",
    "nodeId": "3",
    "contextKey": null,
    "selector": "main.contactDetailPage > header.pageHero > p:not(.eyebrow)",
    "tag": "P",
    "sourceFile": "app/contact/page.tsx",
    "sourceBlob": "ce52238966b6086ec1c0822a47bb44b4f21d995b",
    "kind": "text",
    "expectedText": "You’ll hear back personally. Share the business, technology, or project challenge—not passwords, payment details, or other sensitive information."
  },
  {
    "id": "contact-intro-title",
    "page": "10",
    "route": "/contact",
    "nodeId": "5",
    "contextKey": "page:3.0.0.1",
    "selector": "main.contactDetailPage > section.pageContact > .contactGrid > div > h2",
    "tag": "H2",
    "sourceFile": "app/contact/page.tsx",
    "sourceBlob": "ce52238966b6086ec1c0822a47bb44b4f21d995b",
    "kind": "text",
    "expectedText": "Clear next steps begin with a useful first conversation."
  },
  {
    "id": "contact-intro-copy",
    "page": "10",
    "route": "/contact",
    "nodeId": "6",
    "contextKey": "page:3.0.0.2",
    "selector": "main.contactDetailPage > section.pageContact > .contactGrid > div > p:not(.sectionLabel)",
    "tag": "P",
    "sourceFile": "app/contact/page.tsx",
    "sourceBlob": "ce52238966b6086ec1c0822a47bb44b4f21d995b",
    "kind": "text",
    "expectedText": "Use the form, email, or call. Existing customers can contact support directly."
  },
{
  "id": "home-statement",
  "page": "0",
  "route": "/",
  "nodeId": "3",
  "contextKey": "page:2.1.2",
  "selector": "main#home.homePage > section.hero.homeFullBleed > .heroCopy > p.heroStatement",
  "tag": "P",
  "sourceFile": "app/page.tsx",
  "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
  "kind": "compound",
  "expectedText": "Considered design. Personal attention.",
  "expectedChildText": "Personal attention.",
  "childTarget": "home-statement-em"
},
{
  "id": "home-statement-em",
  "page": "0",
  "route": "/",
  "nodeId": null,
  "contextKey": "page:2.1.2.0",
  "selector": "main#home.homePage > section.hero.homeFullBleed > .heroCopy > p.heroStatement > em",
  "tag": "EM",
  "sourceFile": "app/page.tsx",
  "sourceBlob": "6c754aefcc61f2661e29d4762755432f7448f5f7",
  "kind": "text",
  "expectedText": "Personal attention."
}
];
