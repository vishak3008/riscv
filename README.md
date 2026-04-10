# RISC Processor ALU Studio

This project is a browser-based RISC processor simulator with a front-end page for testing ALU math and simple instruction execution.

## What it does

- Simulates a compact RISC-style CPU in JavaScript
- Provides 32 general-purpose registers `x0` to `x31`
- Keeps `x0` fixed at zero
- Tracks the program counter and cycle count
- Supports a small data memory for `lw` and `sw`
- Runs instructions step by step or as a whole program
- Shows a live execution trace in the browser

## Supported instructions

- R-type style math: `add`, `sub`, `and`, `or`, `xor`, `slt`
- Immediate: `addi`
- Memory: `lw`, `sw`
- Control flow: `beq`, `jal`

## Files

- `index.html` - Front-end page
- `styles.css` - Visual design and responsive layout
- `app.js` - RISC processor, ALU logic, parser, and UI wiring

## How to run

No build tools are required.

1. Open `index.html` in your browser
2. Use the sample program or type your own instructions
3. Click `Assemble`, `Step`, or `Run Program`
4. Watch registers, memory, PC, and trace update live

## Example program

```text
addi x1, x0, 18
addi x2, x0, 6
add x3, x1, x2
sub x4, x1, x2
xor x5, x3, x4
and x6, x3, x2
or x7, x4, x2
slt x8, x2, x1
sw x3, 0(x0)
lw x9, 0(x0)
beq x3, x9, equal
addi x10, x0, 0
jal x0, finish
equal:
addi x10, x0, 1
finish:
```

## Notes

- Labels are supported for `beq` and `jal`
- Memory addresses must be word-aligned
- This is a functional simulator for learning and demonstration, not a hardware implementation
