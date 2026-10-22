import {
  Eye,
  FolderTree,
  HardDrive,
  History,
  Monitor,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface Feature {
  icon: LucideIcon
  title: string
  summary: string
  points: string[]
  doc: string
}

// Only features that exist in the product, described as they work today
// (see docs/AUDIT.md for how each one was checked).
export const features: Feature[] = [
  {
    icon: Upload,
    title: 'Upload files and whole folders',
    summary: 'Drop in single files or entire folders. Folder names and structure are kept, and each upload shows its own progress.',
    points: [
      'Drag and drop or choose files and folders',
      'Photos are resized to at most 1600 pixels before upload; other files upload unchanged',
      'Files whose contents are already in your vault are flagged as duplicates',
    ],
    doc: '/documentation/file-management',
  },
  {
    icon: FolderTree,
    title: 'Folders, categories and tags',
    summary: 'Organise documents the way you think about them: nested folders, a category for each file, and free-form tags.',
    points: ['Nested folders with breadcrumbs', 'Categories such as Personal, Work and Certificates', 'Tags you can search with #tag'],
    doc: '/documentation/file-management',
  },
  {
    icon: Search,
    title: 'Search that finds what you meant',
    summary: 'Search by name, folder, category and tag, and inside the text of PDFs, Word files, spreadsheets and slides.',
    points: ['Matches inside document text, with excerpts', 'Text recognition for scans and photos of documents', 'Ctrl K to search from anywhere'],
    doc: '/documentation/search',
  },
  {
    icon: Eye,
    title: 'Preview without downloading',
    summary: 'Open PDFs, Word, Excel and PowerPoint files, images, text, e-books, audio and video right in the browser.',
    points: ['Large PDFs open on page one and stay smooth', 'PowerPoint slideshow with transitions', 'ZIP files list their contents without extracting'],
    doc: '/documentation/web-app',
  },
  {
    icon: History,
    title: 'Versions, favourites and recent files',
    summary: 'Upload a new version of a document and keep the old ones. Star the files you need most and find recent ones quickly.',
    points: ['Version history with restore and download', 'Favourites and Recent pages', 'Edit a file’s category and description'],
    doc: '/documentation/file-management',
  },
  {
    icon: Trash2,
    title: 'Trash with restore',
    summary: 'Deleted files go to Trash first, so a mistake can be undone. Empty it when you are sure.',
    points: ['Restore single files or whole selections', 'Delete permanently from Trash', 'Bulk actions for many files at once'],
    doc: '/documentation/file-management',
  },
  {
    icon: Zap,
    title: 'Fast opening',
    summary: 'Documents you upload or open are prepared on your device in the background, so they open almost instantly next time.',
    points: ['First pages and slides kept on this device', 'Nothing prepared is sent anywhere', 'Clear prepared copies from Settings'],
    doc: '/documentation/web-app',
  },
  {
    icon: WifiOff,
    title: 'Works as an installed app',
    summary: 'Install Document Vault from the browser on a computer or phone. It opens in its own window like any other app.',
    points: ['Chrome, Edge, Android and iPhone', 'Documents you open are kept on the device for reuse', 'Updates arrive with the website'],
    doc: '/documentation/pwa',
  },
  {
    icon: Monitor,
    title: 'Search files on your computer',
    summary: 'The desktop app can index folders you choose on your computer, so you can find and preview local files next to your vault.',
    points: ['Only the folders you add are indexed', 'Nothing on your computer is uploaded', 'Programs and scripts are never opened'],
    doc: '/documentation/desktop-app',
  },
]

export const trustPoints = [
  {
    icon: HardDrive,
    title: 'Your files stay in your Google Drive',
    text: 'Documents are stored in your own Drive, in a Document Vault folder. Document Vault can only see the files it created or that you opened with it.',
  },
  {
    icon: ShieldCheck,
    title: 'Only you can see your records',
    text: 'Sign-in is through Google. Each account can only read and change its own records; the database rules refuse everything else.',
  },
  {
    icon: Tags,
    title: 'No advertising, no tracking',
    text: 'The site has no analytics or advertising scripts. Prepared previews and offline copies stay in your browser.',
  },
]
