import { Command } from "commander";

const program = new Command();

program
  .name("smartransact")
  .description("Smart Transaction Stack — live Solana bundle lifecycle evidence tool")
  .version("0.1.0");

program
  .command("run")
  .description("Orchestrate a full evidence session end-to-end")
  .action(() => {
    console.log("run: not yet implemented");
  });

program
  .command("inject-fault")
  .description("Fire a blockhash-expiry fault drill on demand")
  .action(() => {
    console.log("inject-fault: not yet implemented");
  });

program
  .command("tail")
  .description("Render a live lifecycle view from the evidence log")
  .action(() => {
    console.log("tail: not yet implemented");
  });

program.parse();
