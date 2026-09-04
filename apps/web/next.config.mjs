/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Every page lives under /[locale]. Typing an unprefixed path — /admin, /login — is the natural
   * thing to do and used to 404, so send those to the default locale rather than a dead end.
   */
  async redirects() {
    const sections = ["admin", "app", "login", "signup", "about", "demo", "verify", "landingpage"];
    return sections.flatMap((s) => [
      { source: `/${s}`, destination: `/en/${s}`, permanent: false },
      { source: `/${s}/:path*`, destination: `/en/${s}/:path*`, permanent: false },
    ]);
  },
  /**
   * The model weights are ~190 MB of content-fixed binary — the AdaFace backbone dwarfs the five
   * face-api nets — and the onnxruntime wasm beside them is another 40 MB. Without this they are
   * revalidated on every visit, which is most of what "loading the face models" used to mean on a
   * second run. Both paths are only ever written by `pnpm models:fetch`, so nothing here can go
   * stale behind the year-long max-age.
   */
  async headers() {
    return [
      // Model weights are named for the model inside them, so a given filename's bytes never change.
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // The onnxruntime artefacts are *not* content-addressed: `pnpm models:fetch` copies them out
      // of node_modules under fixed names, so bumping onnxruntime-web rewrites the same two paths.
      // `immutable` would pin a browser to last version's glue against this version's wasm, which
      // fails in ways nobody would think to look for — so these revalidate instead. A 304 on a
      // 28 MB file costs nothing; being wrong about it costs a demo.
      { source: "/ort/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }] },
    ];
  },
  transpilePackages: ["@vajra/contracts"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
