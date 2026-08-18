const fs = require('fs');

let dFile = fs.readFileSync('src/components/DispatchValetOrder.tsx', 'utf8');

const lines = dFile.split('\n');

// 1. Remove second getSquadMemberId
const targetStr = "  // Helper to calculate member ID: developer default 888888, first management member 000001, subsequent squad members 000002, 000003, etc.";
let firstIdx = -1;
let secondIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === targetStr) {
    if (firstIdx === -1) firstIdx = i;
    else {
      secondIdx = i;
      break;
    }
  }
}

console.log("First:", firstIdx, "Second:", secondIdx);

if (secondIdx !== -1) {
  // Find where it ends
  let endIdx = -1;
  for (let i = secondIdx; i < lines.length; i++) {
    if (lines[i] === "  };") {
      endIdx = i;
      break;
    }
  }
  if (endIdx !== -1) {
     lines.splice(secondIdx, endIdx - secondIdx + 1);
     console.log("Removed from", secondIdx, "to", endIdx);
  }
}

// 2. Fix end of file
let lastLineIdx = lines.length - 1;
if (lines[lastLineIdx] === "}") {
  lines[lastLineIdx] = "};";
  lines.push("");
  lines.push("export default DispatchValetOrder;");
} else if (lines[lastLineIdx].endsWith("}")) {
  lines[lastLineIdx] = lines[lastLineIdx].replace(/\}$/, "};\n\nexport default DispatchValetOrder;\n");
}

fs.writeFileSync('src/components/DispatchValetOrder.tsx', lines.join('\n'));

