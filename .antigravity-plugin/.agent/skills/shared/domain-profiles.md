# Domain Profiles

A skill's frontmatter may declare `preconditions:` — a subset of `artifact-cheap-to-modify`, `execution-safe`, `failure-is-cheap` — naming what it assumes about the codebase it runs against. A repository states which of those hold in `.superpowers/domain-profile.json`. Two profiles are named: `greenfield`, which is what an absent file means, and `verification`, shipped as a template.

The mechanism and the routing obligation live in the Skill Preconditions section of `using-superpowers/references/routing-guide.md`. This file is the catalogue.

## greenfield — the default

A repository with no `.superpowers/domain-profile.json` is `greenfield`: **all three preconditions hold.** So does one whose profile is unreadable, malformed, or not a JSON object — the loader fails open to greenfield in every case, which is why a typo in a profile restores the default rather than producing an error.

Greenfield is the assumption every skill in this plugin was written under: an edit is undone by a commit, running the artifact costs a test run, and a failure is information you buy cheaply and often. Application code, services, libraries and tooling are greenfield. Writing the all-true profile out explicitly is legal and changes nothing.

## verification

Copy `${CLAUDE_PLUGIN_ROOT}/skills/shared/domain-profiles/verification.json` to `.superpowers/domain-profile.json` at the repository root:

```json
{
  "artifact-cheap-to-modify": false,
  "execution-safe": false,
  "failure-is-cheap": false
}
```

**Repository kinds it fits:** embedded firmware and hardware-in-the-loop work; infrastructure whose changes reach production; data migration; regulated or scientific code. What unites them is that the work is establishing what is true about an artifact, and the artifact answers back at a price.

**`execution-safe: false`** — running the artifact can damage hardware, mutate production state, or consume a migration window that does not reopen. Execution is a decision with a cost, not the default way to learn something.

**`failure-is-cheap: false`** — a failure is a bricked board, a half-applied migration, or a re-certification, not a red bar you read and move past. The inverse matters as much: in these domains a *pass* is the documented failure mode. A decoder tested against its own assumptions goes green while being wrong about every byte, so verification means two independently written implementations agreeing on the same input, and a single green test is the weakest evidence available rather than the strongest.

**`artifact-cheap-to-modify: false`** — the value is not self-evident across every repository kind above, so it is fixed here. A reverse-engineering repository holds two artifacts: the vendor image under study, which cannot be modified at all, and the decoders written against it, which are as cheap to change as any script. An artifact that cannot be changed is not cheap to change, so the case resolves to `false` on the artifact the work is actually about. The other three kinds resolve to `false` directly — a firmware change costs a flash cycle and a bricking risk, an infrastructure change lands on running systems, an applied migration is undone only by writing another one, and regulated code re-enters validation on every edit. No skill this plugin ships declares `artifact-cheap-to-modify`, so the key changes no routing today; it states a property of the domain that becomes load-bearing when a skill declares that assumption.

### What installing it changes

`test-driven-development` and `systematic-debugging` both declare `execution-safe` and `failure-is-cheap`, so both conflict with this profile.

- **Automatic effect, in full:** the prompt-submit hook stops offering its one-line advisory nudge for those two skills. Nothing else in the plugin reads the profile.
- **Routing effect:** both skills stay reachable and stay invokable. Routing names the conflict — that the profile marks `execution-safe: false`, that the skill assumes otherwise — and requires explicit acknowledgement before proceeding. A genuine bug in a repository that cannot safely run its artifact still routes to `systematic-debugging`; the profile changes what is said on the way in, not whether the skill is available.

Suppressing the skill instead would trade a silent wrong assumption for a silent missing skill, which is the worse of the two.

## Writing a profile for another domain

A profile records a property of the repository, not a preference about how to work. Mark a key `false` only where it is factually false, and expect to justify it the way the three keys above are justified — a profile that overstates its domain trains the reader to acknowledge conflicts without reading them.

Only an explicit `false` on one of the three known keys marks a precondition unmet. Unknown keys are ignored, and so is any value other than `false`, including the string `"false"`.
