import { LIST, STATES, bold, cyan, dim } from "./common.js";

export const HELP = `${bold("aurb")}: animated orbs for AI products

  ${cyan("npx @aurb/player")}                       pick an orb and get its code
  ${cyan("npx @aurb/player add")} aurora            the code for one orb  ${dim("--html  --state thinking  --json")}
  ${cyan("npx @aurb/player list")}                  every orb  ${dim("--json")}
  ${cyan("npx @aurb/player preview")} aurora        play it in your browser, every state  ${dim("--port 4300")}
  ${cyan("npx @aurb/player download")} aurora       save the files to host yourself  ${dim("--out public/orbs  --theme dark")}

Making an orb
  ${cyan("npx @aurb/player pack")} ./loops --name nebula   encode your loops into an orb  ${dim('--note "..."  --xl  --out orbs')}
  ${cyan("npx @aurb/player preview")} orbs/nebula        try it before you share it
  ${cyan("npx @aurb/player check")} orbs/nebula          the check a submission runs  ${dim("also npm:aurb-orb-nebula@1.0.0")}
  ${cyan("npx @aurb/player publish")} orbs/nebula        publish it to npm as your own package  ${dim("--dry-run  --readme")}

  ./loops holds one seamless, square loop per state and theme, named like idle-dark.mp4 and idle-light.mov:
  ${STATES.join(", ")}; dark on black, light on white, all the same length.
  Only dark ones, or only light ones, makes an orb for that theme alone.
  Anyone can use it once it's published, as orb="npm:aurb-orb-nebula@1.0.0". To get it listed: ${LIST}
`;
