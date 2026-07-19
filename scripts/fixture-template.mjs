export const renderStudioShellFixture = (fixture) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fixture.width}" height="${fixture.height}" viewBox="0 0 ${fixture.width} ${fixture.height}">
  <rect width="100%" height="100%" fill="#0b0b0e"/>
  <circle cx="470" cy="150" r="92" fill="none" stroke="#e7ff73" stroke-opacity="0.5"/>
  <circle cx="520" cy="205" r="48" fill="#816bff" fill-opacity="0.7"/>
  <text x="52" y="145" fill="#aaa0ee" font-family="monospace" font-size="12">${escapeXml(fixture.eyebrow)}</text>
  <text x="52" y="195" fill="#f5f4f2" font-family="system-ui" font-size="38" font-weight="600">${escapeXml(fixture.title)}</text>
  <text x="52" y="233" fill="#f5f4f2" font-family="system-ui" font-size="38" font-weight="600">${escapeXml(fixture.subtitle)}</text>
  <rect x="52" y="276" width="158" height="28" rx="3" fill="#e7ff73" fill-opacity="0.08" stroke="#e7ff73" stroke-opacity="0.28"/>
  <text x="65" y="294" fill="#ddec92" font-family="monospace" font-size="9">${escapeXml(fixture.badge)}</text>
</svg>
`;

const escapeXml = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
