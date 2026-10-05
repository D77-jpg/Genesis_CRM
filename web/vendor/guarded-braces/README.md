# Guarded braces (private local fork)

This is an MIT-licensed source fork of npm `braces@3.0.3`, named
`@autoforce/guarded-braces@3.0.3-afai.1`. It is **not** an official upstream release.
The original LICENSE is retained. `index.js` and all six original `lib` files came
from that npm release. There are no install scripts, generated bundles or network
calls in this package. Its only external dependency is the original `fill-range`.

## CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm remediation

The upstream release has no nesting bound. This fork adds a mandatory depth ceiling
of 64 to the parser's brace **and parenthesis** stack, all compile/expand/stringify
walkers, expansion array append/flatten recursion and parent-chain walks. The bound
also covers caller-supplied ASTs and cyclic nodes/arrays. Exceeding it raises a
controlled SyntaxError rather than exhausting the JavaScript call stack. Options
cannot disable or increase the bound. The upstream maxLength and rangeLimit guards
remain. An unrelated debug console.log in compile was removed.

This addresses recursive **depth**, not every possible expansion-size problem;
never accept arbitrary untrusted glob patterns without appropriate resource bounds.

The frontend declares the local fork under the dependency key `braces`, and npm
`overrides.braces = "$braces"` redirects every transitive consumer to it.
`install-links=true` copies directory dependencies into node_modules so their
dependencies come from the committed frontend lockfile. The lock names the fork
explicitly. No version is masqueraded as an official patched braces release.

The npm advisory database does not assess unpublished local source. An empty npm
audit report alone therefore does **not** prove this fix: the frontend CI also runs
`tests/guarded-braces.test.cjs` against the actual installed consumers and exercises
3500-level balanced/malformed patterns, ASTs and cyclic arrays. Other advisories and
the original high/critical gate remain enabled with no exceptions. Normal range,
alternation, escaped patterns, real glob consumers and production builds must pass.

When upstream publishes a reviewed fixed release, replace this fork and the
override together after the same regression checks. Do not simply delete the tests.

## Original provenance

- Source: https://registry.npmjs.org/braces/-/braces-3.0.3.tgz
- npm integrity: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- Upstream report: https://github.com/micromatch/braces/issues/70

SHA-256 of the **original**, unmodified source files (LF bytes):

| File | SHA-256 |
| --- | --- |
| index.js | 332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4 |
| lib/parse.js | e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310 |
| lib/compile.js | dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f |
| lib/expand.js | 41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7 |
| lib/stringify.js | 379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a |
| lib/utils.js | b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7 |
| lib/constants.js | c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b |

## Genesis integration

Vendored from the reviewed AutoForceAI source at commit
`1c0beaa46a6302c8a56b0e4286348ca468f314fb` (PR #25). Runtime sources and the
original license are unchanged. Genesis web uses `file:vendor/guarded-braces`
and executes the regression tests in both web and security CI jobs.
The existing SheetJS audit exception is unchanged; this fork adds no exception.
