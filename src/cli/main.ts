import { Command } from "commander";
import { runCommand } from "./run.js";

const program = new Command();

program
  .name("smartransact")
  .description("Smart Transaction Stack — live Solana bundle lifecycle evidence tool")
  .version("0.1.0");

program
  .command("run")
  .description("Orchestrate a full evidence session end-to-end")
  .option("--profile <name>", "Config profile override (overrides smartransact.config.json active field)")
  .action(async (options: { profile?: string }) => {
    await runCommand(options.profile);
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
