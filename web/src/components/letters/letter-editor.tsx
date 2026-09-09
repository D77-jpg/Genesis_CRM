/**
 * 富文本编辑器（React Quill 封装）
 * ------------------------------------------------------------------
 * - 对外暴露 insertAtCursor / focus 两个命令，供占位符按钮在光标处插入 {{token}}
 * - modules 必须用 useMemo 固定引用：React Quill 检测到 modules 变化会重建编辑器，
 *   导致光标丢失、输入卡顿
 * - 深色模式样式已在 index.css 中覆盖 quill.snow.css
 */
import * as React from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Quill 实例的最小接口。
 * 不直接 import 'quill' 的类型：react-quill 依赖的 quill@1 类型来自可选的 @types/quill，
 * 缺失时会导致编译失败，这里只声明真正用到的方法。
 */
interface QuillLike {
  getSelection(focus?: boolean): { index: number; length: number } | null;
  getLength(): number;
  insertText(index: number, text: string, source?: string): unknown;
  setSelection(index: number, length?: number, source?: string): void;
  getText(): string;
}

export interface LetterEditorHandle {
  /** 在光标处插入文本；无选区时追加到末尾 */
  insertAtCursor: (token: string) => void;
  focus: () => void;
  /** 纯文本长度，用于「正文是否为空」的即时判断 */
  getTextLength: () => number;
}

export interface LetterEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 校验失败时给编辑器加红色描边 */
  invalid?: boolean;
  readOnly?: boolean;
  /** 编辑器最小高度（Tailwind 类，默认 min-h-[240px] 由 index.css 控制） */
  className?: string;
  id?: string;
  onBlur?: () => void;
}

/** 工具栏配置：邮件正文常用的那几组，去掉图片上传等用不上的能力 */
const TOOLBAR_OPTIONS: unknown[][] = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['blockquote', 'link'],
  ['clean'],
];

const FORMATS = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'list',
  'bullet',
  'align',
  'blockquote',
  'link',
];

export const LetterEditor = React.forwardRef<LetterEditorHandle, LetterEditorProps>(function LetterEditor(
  { value, onChange, placeholder, invalid = false, readOnly = false, className, id, onBlur },
  ref,
) {
  const quillRef = React.useRef<ReactQuill | null>(null);

  // modules / formats 引用必须稳定
  const modules = React.useMemo(
    () => ({
      toolbar: { container: TOOLBAR_OPTIONS },
      clipboard: { matchVisual: false },
    }),
    [],
  );

  const getEditor = React.useCallback((): QuillLike | null => {
    const instance = quillRef.current;
    if (!instance) return null;
    try {
      return instance.getEditor() as unknown as QuillLike;
    } catch {
      return null;
    }
  }, []);

  React.useImperativeHandle(
    ref,
    (): LetterEditorHandle => ({
      insertAtCursor: (token: string) => {
        const editor = getEditor();
        if (!editor) {
          // 编辑器还没就绪时退化为「追加到末尾」，保证按钮永远有效
          onChange(value ? `${value}${token}` : token);
          return;
        }
        const selection = editor.getSelection(true);
        const index = selection ? selection.index : editor.getLength();
        editor.insertText(index, token, 'user');
        editor.setSelection(index + token.length, 0, 'user');
      },
      focus: () => {
        getEditor()?.getSelection(true);
        quillRef.current?.focus();
      },
      getTextLength: () => (getEditor()?.getText() ?? '').trim().length,
    }),
    [getEditor, onChange, value],
  );

  return (
    <div
      id={id}
      className={cn(
        'letter-editor rounded-md transition-shadow',
        invalid && '[&_.ql-container]:border-destructive [&_.ql-toolbar]:border-destructive',
        readOnly && 'pointer-events-none opacity-70',
        className,
      )}
      onBlur={onBlur}
    >
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={FORMATS}
        placeholder={placeholder}
        readOnly={readOnly}
        preserveWhitespace
      />
    </div>
  );
});

/** 编辑器加载占位（首屏动态 import 时使用） */
export function LetterEditorSkeleton(): React.JSX.Element {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-md border text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      正在加载编辑器…
    </div>
  );
}
