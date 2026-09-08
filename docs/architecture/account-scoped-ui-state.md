# Account-scoped UI state

## Invariant

Authenticated browser state must be isolated by the Firebase Authentication `uid`.
A sign-out, direct account switch, or sign-in as a different user must not preserve UI
state from the previous authenticated identity.

This applies to both persisted browser state and in-memory React state.

## Persisted browser state

Any `localStorage` or similar browser preference that represents user progress must include
the authenticated `uid` in its storage key (or store an explicitly user-keyed value).

Newcomer onboarding currently follows this rule through
`app/src/utils/onboardingStorage.ts`:

- `adaptive_training_onboarding_done_<uid>` is account-scoped.
- the former global `adaptive_training_onboarding_done` key is intentionally **not** treated
  as proof that a newly authenticated user completed onboarding;
- code must not migrate that global value to whichever user signs in next, because its owner
  cannot be determined safely.

## In-memory React state

`app/src/main.tsx` renders `AccountScopedApp`, and `app/src/AccountScopedApp.tsx` keys `App`
by the current Firebase `uid`, with one shared `anonymous` key while no user is authenticated.

Changing identity therefore replaces the whole `App` subtree instead of relying only on a
list of manual resets. Moving between unauthenticated auth-bootstrap phases does not remount
the login UI. This is deliberate: account-scoped state includes navigation, forms,
active-session UI, authoring state, onboarding state, and callback closures owned by child
components. A stale asynchronous callback from the old subtree can finish, but its React
state updates target the unmounted old `App` instance rather than the new account's instance.

Individual screen keys and explicit reset/cancellation guards remain useful defense in depth,
especially for date-scoped state and asynchronous reads.

## Service boundary

A React remount does not cancel external side effects. Services that read or write user data
must therefore continue to receive the intended `uid` explicitly and persist beneath that
user's data boundary. Do not make account ownership depend on mutable screen state or on a
legacy global browser key.

## Regression scenario

When changing this area, preserve at least this behavior:

1. User A signs in and completes/dismisses onboarding.
2. User A navigates away from the initial screen and may have in-flight UI work.
3. User A signs out (or the auth observer switches directly to another identity).
4. User B signs in on the same browser and same calendar day.
5. User B starts with a fresh account-scoped UI tree and does not inherit User A's onboarding
   completion, navigation, form/session state, or browser persistence.

The storage-level portion is covered by `app/src/utils/onboardingStorage.test.ts`.

## References

- React: *Preserving and Resetting State* — https://react.dev/learn/preserving-and-resetting-state
- Firebase Authentication: *Manage Users in Firebase* — https://firebase.google.com/docs/auth/web/manage-users
