import { ViewDocumentButton } from "@/components/documents/view-document-button";

export interface DocumentRow {
  id: string;
  file_name: string;
  file_type: string;
  created_at: string;
  document_types: { name: string; sensitive: boolean } | null;
}

export function DocumentList({ documents }: { documents: DocumentRow[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents uploaded yet.</p>;
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full max-w-2xl min-w-[480px] text-left text-sm sm:min-w-0">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Type</th>
            <th className="py-2 font-medium">File</th>
            <th className="py-2 font-medium">Uploaded</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr
              key={doc.id}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
            >
              <td className="py-2">
                {doc.document_types?.name ?? "—"}
                {doc.document_types?.sensitive ? (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Sensitive
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">{doc.file_name}</td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">
                {new Date(doc.created_at).toLocaleDateString()}
              </td>
              <td className="py-2 text-right">
                <ViewDocumentButton documentId={doc.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
