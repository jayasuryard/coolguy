# Audio

Menu, pause and credits music and the UI sounds are composed in code
(`game/src/ui/ShellAudio.ts`), so nothing here is required. To replace a cue with a recording,
drop a file named after the cue:

| File                | Plays on                |
| ------------------- | ----------------------- |
| `menu-theme.mp3`    | Main menu and Settings  |
| `pause-theme.mp3`   | Pause                   |
| `credits-theme.mp3` | Credits                 |

Recordings loop, crossfade between screens, and follow Master × Music volume and Mono output.
