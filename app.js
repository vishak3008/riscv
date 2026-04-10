class RegisterFile {
    constructor() {
        this.reset();
    }

    reset() {
        this.registers = new Array(32).fill(0);
    }

    read(index) {
        return index === 0 ? 0 : (this.registers[index] | 0);
    }

    write(index, value) {
        if (index !== 0) {
            this.registers[index] = value | 0;
        }
        this.registers[0] = 0;
    }

    dump() {
        this.registers[0] = 0;
        return [...this.registers];
    }
}

class Memory {
    constructor() {
        this.reset();
    }

    reset() {
        this.words = new Map();
    }

    loadWord(address) {
        if (address % 4 !== 0) {
            throw new Error(`Unaligned load at address ${address}`);
        }
        return this.words.get(address) ?? 0;
    }

    storeWord(address, value) {
        if (address % 4 !== 0) {
            throw new Error(`Unaligned store at address ${address}`);
        }
        this.words.set(address, value | 0);
    }

    dump() {
        return [...this.words.entries()].sort((a, b) => a[0] - b[0]);
    }
}

class ALU {
    static execute(op, a, b) {
        switch (op) {
            case "add":
            case "addi":
                return (a + b) | 0;
            case "sub":
                return (a - b) | 0;
            case "and":
                return a & b;
            case "or":
                return a | b;
            case "xor":
                return a ^ b;
            case "slt":
                return a < b ? 1 : 0;
            default:
                throw new Error(`Unsupported ALU op: ${op}`);
        }
    }
}

class RiscProcessor {
    constructor() {
        this.registers = new RegisterFile();
        this.dataMemory = new Memory();
        this.reset();
    }

    reset() {
        this.pc = 0;
        this.cycle = 0;
        this.program = [];
        this.trace = [];
        this.history = [];
        this.lastAluResult = null;
        this.lastAction = "Ready";
        this.lastWrittenRegister = null;
        this.currentInstruction = "No instruction yet";
        this.signalState = {
            activeUnits: ["pc"],
            aluA: null,
            aluB: null,
            aluOut: null,
            memoryAddress: null,
            branch: "Idle"
        };
        this.halted = false;
    }

    loadProgram(lines) {
        this.reset();
        this.program = this.assemble(lines);
    }

    assemble(lines) {
        const cleaned = lines
            .map((line) => line.split("#")[0].trim())
            .filter(Boolean);

        const labels = new Map();
        let pc = 0;
        cleaned.forEach((line) => {
            if (line.endsWith(":")) {
                labels.set(line.slice(0, -1).trim(), pc);
            } else {
                pc += 4;
            }
        });

        pc = 0;
        const program = [];
        cleaned.forEach((line) => {
            if (line.endsWith(":")) {
                return;
            }
            program.push(this.parseInstruction(line, labels, pc));
            pc += 4;
        });
        return program;
    }

    parseInstruction(line, labels, pc) {
        const normalized = line.replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ");
        const parts = normalized.split(/\s+/).filter(Boolean);
        const op = parts[0].toLowerCase();

        const reg = (token) => {
            if (!/^x([0-9]|[12][0-9]|3[01])$/i.test(token)) {
                throw new Error(`Invalid register in "${line}"`);
            }
            return Number(token.slice(1));
        };

        const imm = (token) => Number(token);
        const labelOrImmediate = (token) => (labels.has(token) ? labels.get(token) - pc : imm(token));

        switch (op) {
            case "add":
            case "sub":
            case "and":
            case "or":
            case "xor":
            case "slt":
                return { op, rd: reg(parts[1]), rs1: reg(parts[2]), rs2: reg(parts[3]), text: line };
            case "addi":
                return { op, rd: reg(parts[1]), rs1: reg(parts[2]), imm: imm(parts[3]), text: line };
            case "lw":
                return { op, rd: reg(parts[1]), imm: imm(parts[2]), rs1: reg(parts[3]), text: line };
            case "sw":
                return { op, rs2: reg(parts[1]), imm: imm(parts[2]), rs1: reg(parts[3]), text: line };
            case "beq":
                return { op, rs1: reg(parts[1]), rs2: reg(parts[2]), offset: labelOrImmediate(parts[3]), text: line };
            case "jal":
                return { op, rd: reg(parts[1]), offset: labelOrImmediate(parts[2]), text: line };
            default:
                throw new Error(`Unsupported instruction: "${line}"`);
        }
    }

    step() {
        if (this.halted) {
            return false;
        }

        const index = this.pc / 4;
        if (index < 0 || index >= this.program.length) {
            this.halted = true;
            this.lastAction = "Program completed";
            return false;
        }

        const inst = this.program[index];
        const currentPc = this.pc;
        let nextPc = this.pc + 4;
        let detail = "";
        this.lastWrittenRegister = null;
        this.currentInstruction = inst.text;
        this.signalState = {
            activeUnits: ["pc", "decoder", "registers"],
            aluA: null,
            aluB: null,
            aluOut: null,
            memoryAddress: null,
            branch: "Sequential"
        };

        switch (inst.op) {
            case "add":
            case "sub":
            case "and":
            case "or":
            case "xor":
            case "slt": {
                const a = this.registers.read(inst.rs1);
                const b = this.registers.read(inst.rs2);
                const result = ALU.execute(inst.op, a, b);
                this.registers.write(inst.rd, result);
                this.lastAluResult = result;
                this.lastWrittenRegister = inst.rd;
                this.signalState = {
                    activeUnits: ["pc", "decoder", "registers", "alu", "writeback"],
                    aluA: a,
                    aluB: b,
                    aluOut: result,
                    memoryAddress: null,
                    branch: "Sequential"
                };
                detail = `x${inst.rd} <- ${result}`;
                break;
            }
            case "addi": {
                const a = this.registers.read(inst.rs1);
                const result = ALU.execute(inst.op, a, inst.imm);
                this.registers.write(inst.rd, result);
                this.lastAluResult = result;
                this.lastWrittenRegister = inst.rd;
                this.signalState = {
                    activeUnits: ["pc", "decoder", "registers", "alu", "writeback"],
                    aluA: a,
                    aluB: inst.imm,
                    aluOut: result,
                    memoryAddress: null,
                    branch: "Sequential"
                };
                detail = `x${inst.rd} <- ${result}`;
                break;
            }
            case "lw": {
                const address = (this.registers.read(inst.rs1) + inst.imm) | 0;
                const value = this.dataMemory.loadWord(address);
                this.registers.write(inst.rd, value);
                this.lastAluResult = value;
                this.lastWrittenRegister = inst.rd;
                this.signalState = {
                    activeUnits: ["pc", "decoder", "registers", "alu", "memory", "writeback"],
                    aluA: this.registers.read(inst.rs1),
                    aluB: inst.imm,
                    aluOut: address,
                    memoryAddress: address,
                    branch: "Load"
                };
                detail = `load mem[${address}] -> x${inst.rd}`;
                break;
            }
            case "sw": {
                const address = (this.registers.read(inst.rs1) + inst.imm) | 0;
                const value = this.registers.read(inst.rs2);
                this.dataMemory.storeWord(address, value);
                this.lastAluResult = value;
                this.signalState = {
                    activeUnits: ["pc", "decoder", "registers", "alu", "memory"],
                    aluA: this.registers.read(inst.rs1),
                    aluB: inst.imm,
                    aluOut: address,
                    memoryAddress: address,
                    branch: "Store"
                };
                detail = `store x${inst.rs2} -> mem[${address}]`;
                break;
            }
            case "beq": {
                const left = this.registers.read(inst.rs1);
                const right = this.registers.read(inst.rs2);
                this.signalState = {
                    activeUnits: ["pc", "decoder", "registers", "alu"],
                    aluA: left,
                    aluB: right,
                    aluOut: left - right,
                    memoryAddress: null,
                    branch: "Not taken"
                };
                if (left === right) {
                    nextPc = this.pc + inst.offset;
                    this.signalState.branch = `Taken -> 0x${this.toHex(nextPc)}`;
                    detail = `branch taken to 0x${this.toHex(nextPc)}`;
                } else {
                    detail = "branch not taken";
                }
                break;
            }
            case "jal": {
                this.registers.write(inst.rd, this.pc + 4);
                nextPc = this.pc + inst.offset;
                this.lastWrittenRegister = inst.rd;
                this.signalState = {
                    activeUnits: ["pc", "decoder", "writeback"],
                    aluA: this.pc,
                    aluB: inst.offset,
                    aluOut: this.pc + 4,
                    memoryAddress: null,
                    branch: `Jump -> 0x${this.toHex(nextPc)}`
                };
                detail = `jump to 0x${this.toHex(nextPc)}`;
                break;
            }
            default:
                throw new Error(`Execution not implemented for ${inst.op}`);
        }

        this.trace.unshift({
            cycle: this.cycle,
            pc: currentPc,
            instruction: inst.text,
            detail
        });

        this.pc = nextPc;
        this.cycle += 1;
        this.lastAction = detail || "Instruction executed";
        this.recordHistory(inst.text);
        return true;
    }

    run(maxCycles = 64) {
        let executed = 0;
        while (executed < maxCycles && this.step()) {
            executed += 1;
        }
        if (executed === maxCycles && !this.halted) {
            this.lastAction = "Stopped after safety limit";
        }
    }

    executePlayground({ op, rd, rs1, rs2, imm }) {
        const sourceA = this.registers.read(rs1);
        let result;
        let operandB;

        if (op === "addi") {
            operandB = imm;
            result = ALU.execute(op, sourceA, imm);
        } else {
            operandB = this.registers.read(rs2);
            result = ALU.execute(op, sourceA, operandB);
        }

        this.registers.write(rd, result);
        this.lastAluResult = result;
        this.lastWrittenRegister = rd;
        this.currentInstruction = op === "addi"
            ? `addi x${rd}, x${rs1}, ${imm}`
            : `${op} x${rd}, x${rs1}, x${rs2}`;
        this.signalState = {
            activeUnits: ["registers", "alu", "writeback"],
            aluA: sourceA,
            aluB: operandB,
            aluOut: result,
            memoryAddress: null,
            branch: "Playground"
        };
        this.lastAction = `Playground: ${op} wrote ${result} to x${rd}`;
        this.trace.unshift({
            cycle: this.cycle,
            pc: this.pc,
            instruction: `${op} playground`,
            detail: this.lastAction
        });
        this.cycle += 1;
        this.recordHistory(this.currentInstruction);
    }

    recordHistory(label) {
        this.history.push({
            cycle: this.cycle,
            label,
            aluResult: this.lastAluResult ?? 0,
            registers: this.registers.dump().slice(1, 9)
        });
        if (this.history.length > 24) {
            this.history.shift();
        }
    }

    toHex(value) {
        return (value >>> 0).toString(16).padStart(8, "0");
    }
}

const sampleProgram = [
    "addi x1, x0, 18",
    "addi x2, x0, 6",
    "add x3, x1, x2",
    "sub x4, x1, x2",
    "xor x5, x3, x4",
    "and x6, x3, x2",
    "or x7, x4, x2",
    "slt x8, x2, x1",
    "sw x3, 0(x0)",
    "lw x9, 0(x0)",
    "beq x3, x9, equal",
    "addi x10, x0, 0",
    "jal x0, finish",
    "equal:",
    "addi x10, x0, 1",
    "finish:"
].join("\n");

const processor = new RiscProcessor();

const dom = {
    programInput: document.getElementById("program-input"),
    instructionCount: document.getElementById("instruction-count"),
    cycleCount: document.getElementById("cycle-count"),
    pcValue: document.getElementById("pc-value"),
    aluResult: document.getElementById("alu-result"),
    lastAction: document.getElementById("last-action"),
    currentInstruction: document.getElementById("current-instruction"),
    diagramStatus: document.getElementById("diagram-status"),
    signalA: document.getElementById("signal-a"),
    signalB: document.getElementById("signal-b"),
    signalOut: document.getElementById("signal-out"),
    signalMem: document.getElementById("signal-mem"),
    signalBranch: document.getElementById("signal-branch"),
    aluChart: document.getElementById("alu-chart"),
    registerChart: document.getElementById("register-chart"),
    registerGrid: document.getElementById("register-grid"),
    memoryList: document.getElementById("memory-list"),
    traceList: document.getElementById("trace-list"),
    playRd: document.getElementById("play-rd"),
    playRs1: document.getElementById("play-rs1"),
    playRs2: document.getElementById("play-rs2"),
    playOp: document.getElementById("play-op"),
    playImm: document.getElementById("play-imm"),
    rs2Wrapper: document.getElementById("rs2-wrapper"),
    immWrapper: document.getElementById("imm-wrapper")
};

function createRegisterOptions() {
    const options = Array.from({ length: 32 }, (_, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `x${index}`;
        return option;
    });

    [dom.playRd, dom.playRs1, dom.playRs2].forEach((select) => {
        options.forEach((option) => {
            select.appendChild(option.cloneNode(true));
        });
    });

    dom.playRd.value = "1";
    dom.playRs1.value = "1";
    dom.playRs2.value = "2";
}

function refreshUi() {
    dom.instructionCount.textContent = String(processor.program.length);
    dom.cycleCount.textContent = String(processor.cycle);
    dom.pcValue.textContent = `0x${processor.toHex(processor.pc)}`;
    dom.aluResult.textContent = processor.lastAluResult === null ? "-" : `${processor.lastAluResult}`;
    dom.lastAction.textContent = processor.lastAction;
    dom.currentInstruction.textContent = processor.currentInstruction;
    dom.diagramStatus.textContent = processor.signalState.activeUnits.join(" -> ");
    dom.signalA.textContent = formatSignal(processor.signalState.aluA);
    dom.signalB.textContent = formatSignal(processor.signalState.aluB);
    dom.signalOut.textContent = formatSignal(processor.signalState.aluOut);
    dom.signalMem.textContent = processor.signalState.memoryAddress === null
        ? "-"
        : `0x${processor.toHex(processor.signalState.memoryAddress)}`;
    dom.signalBranch.textContent = processor.signalState.branch;

    renderDiagram();
    renderGraphs();
    renderRegisters();
    renderMemory();
    renderTrace();
}

function formatSignal(value) {
    return value === null ? "-" : `${value}`;
}

function renderDiagram() {
    document.querySelectorAll(".diagram-node").forEach((node) => {
        const role = node.getAttribute("data-role");
        node.classList.toggle("active", processor.signalState.activeUnits.includes(role));
    });
}

function renderGraphs() {
    renderAluChart();
    renderRegisterChart();
}

function renderAluChart() {
    const history = processor.history.slice(-12);
    if (!history.length) {
        dom.aluChart.innerHTML = `<text x="260" y="110" class="chart-axis-label">Run an instruction to generate the ALU graph.</text>`;
        return;
    }

    const width = 520;
    const height = 220;
    const left = 38;
    const right = 18;
    const top = 18;
    const bottom = 34;
    const values = history.map((entry) => entry.aluResult);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 1);
    const range = maxValue - minValue || 1;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const stepX = history.length === 1 ? 0 : plotWidth / (history.length - 1);

    const points = history.map((entry, index) => {
        const x = left + index * stepX;
        const normalized = (entry.aluResult - minValue) / range;
        const y = top + plotHeight - normalized * plotHeight;
        return { x, y, label: entry.cycle, value: entry.aluResult };
    });

    const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
    const gridLines = [0, 0.5, 1].map((ratio) => {
        const y = top + plotHeight * ratio;
        return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>`;
    }).join("");
    const labels = points.map((point) =>
        `<text x="${point.x}" y="${height - 10}" class="chart-axis-label">${point.label}</text>`
    ).join("");
    const circles = points.map((point) =>
        `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4.5"></circle>`
    ).join("");

    dom.aluChart.innerHTML = `
        ${gridLines}
        <line class="chart-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line>
        <line class="chart-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
        <polyline class="chart-line" points="${polyline}"></polyline>
        ${circles}
        <text x="18" y="${top + 8}" class="chart-axis-label">${maxValue}</text>
        <text x="18" y="${height - bottom}" class="chart-axis-label">${minValue}</text>
        ${labels}
    `;
}

function renderRegisterChart() {
    const registers = processor.registers.dump().slice(1, 9);
    const width = 520;
    const height = 220;
    const left = 24;
    const right = 18;
    const top = 18;
    const bottom = 42;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxMagnitude = Math.max(1, ...registers.map((value) => Math.abs(value)));
    const barWidth = plotWidth / registers.length - 12;

    const bars = registers.map((value, index) => {
        const x = left + index * (plotWidth / registers.length) + 8;
        const normalized = Math.abs(value) / maxMagnitude;
        const barHeight = normalized * plotHeight;
        const y = top + (plotHeight - barHeight);
        return `
            <rect class="chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="10"></rect>
            <text class="chart-bar-label" x="${x + barWidth / 2}" y="${height - 16}">x${index + 1}</text>
            <text class="chart-value-label" x="${x + barWidth / 2}" y="${Math.max(14, y - 6)}">${value}</text>
        `;
    }).join("");

    dom.registerChart.innerHTML = `
        <line class="chart-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}"></line>
        <line class="chart-axis" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
        <line class="chart-grid-line" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
        <line class="chart-grid-line" x1="${left}" y1="${top + plotHeight / 2}" x2="${width - right}" y2="${top + plotHeight / 2}"></line>
        ${bars}
    `;
}

function renderRegisters() {
    dom.registerGrid.innerHTML = "";
    processor.registers.dump().forEach((value, index) => {
        const card = document.createElement("div");
        card.className = "register-card";
        if (processor.lastWrittenRegister === index) {
            card.classList.add("active");
        }

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = `x${index}`;

        const signed = document.createElement("span");
        signed.className = "value";
        signed.textContent = `${value} / 0x${processor.toHex(value)}`;

        card.append(name, signed);
        dom.registerGrid.appendChild(card);
    });
}

function renderMemory() {
    dom.memoryList.innerHTML = "";
    const items = processor.dataMemory.dump();
    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "memory-item";
        empty.textContent = "No stored words yet.";
        dom.memoryList.appendChild(empty);
        return;
    }

    items.forEach(([address, value]) => {
        const item = document.createElement("div");
        item.className = "memory-item";
        item.innerHTML = `<code>0x${processor.toHex(address)}</code> = <strong>${value}</strong> <code>(0x${processor.toHex(value)})</code>`;
        dom.memoryList.appendChild(item);
    });
}

function renderTrace() {
    dom.traceList.innerHTML = "";
    if (!processor.trace.length) {
        const empty = document.createElement("div");
        empty.className = "trace-item";
        empty.textContent = "No execution yet. Assemble a program or use the playground.";
        dom.traceList.appendChild(empty);
        return;
    }

    processor.trace.slice(0, 24).forEach((entry) => {
        const item = document.createElement("div");
        item.className = "trace-item";
        item.innerHTML = `<strong>Cycle ${entry.cycle}</strong> <code>PC 0x${processor.toHex(entry.pc)}</code><br>${entry.instruction}<br><span>${entry.detail}</span>`;
        dom.traceList.appendChild(item);
    });
}

function safeRun(action) {
    try {
        action();
        refreshUi();
    } catch (error) {
        processor.lastAction = error.message;
        refreshUi();
    }
}

function togglePlaygroundMode() {
    const immediateMode = dom.playOp.value === "addi";
    dom.rs2Wrapper.classList.toggle("hidden", immediateMode);
    dom.immWrapper.classList.toggle("hidden", !immediateMode);
}

document.getElementById("load-sample").addEventListener("click", () => {
    dom.programInput.value = sampleProgram;
    processor.lastAction = "Sample program loaded";
    refreshUi();
});

document.getElementById("reset-cpu").addEventListener("click", () => {
    safeRun(() => {
        processor.reset();
    });
});

document.getElementById("assemble-button").addEventListener("click", () => {
    safeRun(() => {
        processor.loadProgram(dom.programInput.value.split("\n"));
        processor.lastAction = "Program assembled";
    });
});

document.getElementById("step-button").addEventListener("click", () => {
    safeRun(() => {
        if (!processor.program.length) {
            processor.loadProgram(dom.programInput.value.split("\n"));
        }
        processor.step();
    });
});

document.getElementById("run-button").addEventListener("click", () => {
    safeRun(() => {
        if (!processor.program.length) {
            processor.loadProgram(dom.programInput.value.split("\n"));
        }
        processor.run();
    });
});

document.getElementById("execute-playground").addEventListener("click", () => {
    safeRun(() => {
        processor.executePlayground({
            op: dom.playOp.value,
            rd: Number(dom.playRd.value),
            rs1: Number(dom.playRs1.value),
            rs2: Number(dom.playRs2.value),
            imm: Number(dom.playImm.value)
        });
    });
});

dom.playOp.addEventListener("change", togglePlaygroundMode);

createRegisterOptions();
dom.programInput.value = sampleProgram;
togglePlaygroundMode();
refreshUi();
