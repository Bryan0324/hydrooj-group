# hydrooj-group

**English** | [繁體中文](./README.zh-TW.md)

HydroOJ group plugin:

- users can create teams
- team owners can invite users
- invited users can accept/decline invitations
- teams can register for contests in team mode

For compatibility with existing user-based contest flows, this plugin adds an identity abstraction:

- `user` identity -> single member id
- `team` identity -> all team member ids

Contest-related logic can call `resolveIdentity(...)` to get the concrete participant user ids.
