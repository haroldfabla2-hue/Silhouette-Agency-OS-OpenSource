import { pdfExporter } from '../services/pdfExporter';
import * as path from 'path';

async function main() {
    const mdPath = path.join(process.cwd(), 'output', 'papers', 'rigorous', 'rigorous_1766558984210_complete.md');
    console.log('Converting:', mdPath);

    const pdfPath = await pdfExporter.exportToPDF(mdPath);

    if (pdfPath) {
        console.log('✅ PDF created:', pdfPath);
    } else {
        console.log('❌ PDF export failed');
    }
}

main().catch(console.error);
