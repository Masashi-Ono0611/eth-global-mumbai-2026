# references/

Read-only clones of upstream repos that agents read for patterns. Not committed: each is a shallow
clone with its own `.git` (`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1`), named `<owner>_<repo>`.
The table below records the upstream and commit each clone was taken at. Never edit a clone in place.

Research notes for each group live in `docs/research/`.

| Clone | Upstream | Commit | Why |
| --- | --- | --- | --- |
