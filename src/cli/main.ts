import { Command } from "commander";
import { runCommand } from "./run.js";
import { injectFaultCommand } from "./inject-fault.js";
import { tailCommand } from "./tail.js";

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
  .command("inject-fault <fault-type>")
  .description("Fire a fault drill for live demonstration (fault-type: blockhash-expiry)")
  .option("--profile <name>", "Config profile override")
  .action(async (faultType: string, options: { profile?: string }) => {
    await injectFaultCommand(faultType, options.profile);
  });

program
  .command("tail")
  .description("Render a live lifecycle view from the evidence log")
  .action(async () => {
    await tailCommand();
  });

program.parse();
