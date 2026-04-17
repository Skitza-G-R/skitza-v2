"use client";

import { pdfjs } from "react-pdf";

// Point pdf.js to the worker file we copy into /public during build.
// Must be imported at top of any client component that renders a PDF
// before the first <Document /> render.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
