/**
 * 用户表单弹窗（仅管理员）—— 新建 / 编辑双模式
 * ------------------------------------------------------------------
 * react-hook-form + zod 前端校验，后端字段级错误回填到对应输入框。
 * - 新建：用户名 + 初始密码 + 显示名 + 角色
 * - 编辑：仅显示名 + 角色（用户名只读；改密码请走「重置密码」）
 * 通过是否传入 user 区分模式；父组件用 key 强制在两种模式间重挂载，避免 resolver 串味。
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { TriangleAlert, UserCog, UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, FieldMessage, RequiredMark } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { ApiClientError } from '@/lib/api';
import {
  defaultUserFormValues,
  editUserFormSchema,
  userFormSchema,
  type UserFormValues,
} from '@/lib/validators';
import { USER_ROLE_LABEL, USER_ROLE_OPTIONS } from '@/constants';
import { useUserStore } from '@/store/user.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { CreateUserInput, UpdateUserInput, UserDto, UserRole } from '@/types';
import { useProjectStore } from '@/store/project.store';

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为「编辑」模式，为空则为「新建」 */
  user?: UserDto | null;
  /** 新建成功回调 */
  onCreated?: (user: UserDto) => void;
  /** 编辑保存回调 */
  onSaved?: (user: UserDto) => void;
}

/** 新建：表单值 → 创建载荷（显示名留空则不带，交给后端回退为用户名） */
function toCreatePayload(values: UserFormValues): CreateUserInput {
  const displayName = values.displayName?.trim();
  return {
    username: values.username.trim().toLowerCase(),
    password: values.password,
    role: values.role,
    projectIds: values.projectIds,
    ...(displayName ? { displayName } : {}),
  };
}

/** 编辑：表单值 → 更新载荷（只提交显示名 + 角色） */
function toUpdatePayload(values: UserFormValues): UpdateUserInput {
  return { displayName: values.displayName?.trim() ?? '', role: values.role, projectIds: values.projectIds };
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  onCreated,
  onSaved,
}: UserFormDialogProps): React.JSX.Element {
  const isEdit = Boolean(user);
  const createUser = useUserStore((state) => state.createUser);
  const updateUser = useUserStore((state) => state.updateUser);
  const projects = useProjectStore((state) => state.items).filter((project) => project.status === 'active');
  const activeProject = useProjectStore((state) => state.activeProject);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // 编辑模式用目标账号回填；新建模式用空表单
  const initial = React.useMemo<UserFormValues>(
    () =>
      user
        ? { username: user.username, password: '', displayName: user.displayName, role: user.role, projectIds: user.projectIds ?? [] }
        : { ...defaultUserFormValues, projectIds: activeProject ? [activeProject.id] : [] },
    [user, activeProject],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(isEdit ? editUserFormSchema : userFormSchema),
    defaultValues: initial,
    mode: 'onBlur',
  });

  // 每次打开按当前模式重置表单，避免上一次输入残留
  React.useEffect(() => {
    if (open) {
      reset(initial);
      setServerError(null);
    }
  }, [open, reset, initial]);

  const roleValue = watch('role');
  const selectedProjects = watch('projectIds');

  const submit = React.useCallback(async () => {
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        if (isEdit && user) {
          const saved = await updateUser(user.id, toUpdatePayload(values));
          toast.success('用户已更新', {
            description: `${saved?.displayName ?? user.displayName}（${USER_ROLE_LABEL[values.role]}）`,
          });
          if (saved) onSaved?.(saved);
        } else {
          const payload = toCreatePayload(values);
          const created = await createUser(payload);
          toast.success('用户已创建', {
            description: `${created?.displayName ?? payload.username}（${USER_ROLE_LABEL[payload.role]}）`,
          });
          if (created) onCreated?.(created);
        }
        onOpenChange(false);
      } catch (error) {
        // 后端字段级错误回填到表单（如用户名重复）
        if (error instanceof ApiClientError) {
          for (const detail of error.details) {
            const field = (detail.path ?? detail.field ?? '').split('.').pop();
            if (field && field in defaultUserFormValues && detail.message) {
              setError(field as keyof UserFormValues, { message: detail.message });
            }
          }
          setServerError(error.message);
        } else {
          setServerError(
            error instanceof Error ? error.message : isEdit ? '保存失败，请稍后重试' : '创建失败，请稍后重试',
          );
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }, [handleSubmit, isEdit, user, createUser, updateUser, onOpenChange, onCreated, onSaved, setError]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const fieldError = (name: keyof UserFormValues): string | undefined => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <UserCog className="h-4 w-4 text-primary" aria-hidden />
            ) : (
              <UserPlus className="h-4 w-4 text-primary" aria-hidden />
            )}
            {isEdit ? '编辑用户' : '新建用户'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改显示名或角色；用户名不可改，如需改密码请用「重置密码」。'
              : '业务员登录后只能看到并操作分配给自己的客户；管理员可管理全部客户与用户。'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {serverError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <form
            id="user-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div>
              <Label htmlFor="user-username" invalid={Boolean(errors.username)}>
                用户名
                {isEdit ? null : <RequiredMark />}
              </Label>
              <Input
                id="user-username"
                className="mt-1.5"
                placeholder="登录账号，例如 ella"
                autoComplete="off"
                disabled={isEdit}
                invalid={Boolean(errors.username)}
                {...register('username')}
              />
              <FieldMessage
                error={fieldError('username')}
                hint={isEdit ? '用户名不可修改' : '3-40 位，仅限字母、数字、点、下划线、连字符'}
              />
            </div>

            {isEdit ? null : (
              <div>
                <Label htmlFor="user-password" invalid={Boolean(errors.password)}>
                  初始密码
                  <RequiredMark />
                </Label>
                <Input
                  id="user-password"
                  type="password"
                  className="mt-1.5"
                  placeholder="至少 6 位"
                  autoComplete="new-password"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <FieldMessage error={fieldError('password')} hint="创建后请转告本人" />
              </div>
            )}

            <div>
              <Label htmlFor="user-displayName" invalid={Boolean(errors.displayName)}>
                显示名
              </Label>
              <Input
                id="user-displayName"
                className="mt-1.5"
                placeholder="例如 Ella Drake（留空则用用户名）"
                autoComplete="off"
                invalid={Boolean(errors.displayName)}
                {...register('displayName')}
              />
              <FieldMessage error={fieldError('displayName')} />
            </div>

            <div>
              <Label htmlFor="user-role" invalid={Boolean(errors.role)}>
                角色
                <RequiredMark />
              </Label>
              <Select
                value={roleValue}
                onValueChange={(value) => setValue('role', value as UserRole, { shouldValidate: true })}
              >
                <SelectTrigger id="user-role" className="mt-1.5" invalid={Boolean(errors.role)}>
                  <SelectValue placeholder="请选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldMessage
                error={fieldError('role')}
                hint="业务员只看自己名下客户；管理员可分配客户、管理用户"
              />
            </div>

            {roleValue === 'user' ? (
              <fieldset>
                <legend className="text-sm font-medium">可访问项目 <span className="text-destructive">*</span></legend>
                <div className="mt-2 space-y-2 rounded-md border p-3">
                  {projects.map((project) => {
                    const checked = selectedProjects.includes(project.id);
                    return (
                      <label key={project.id} className="flex min-h-9 cursor-pointer items-center gap-3 rounded-sm px-1 text-sm hover:bg-muted/50">
                        <Checkbox checked={checked} onCheckedChange={(next) => setValue('projectIds', next
                          ? [...new Set([...selectedProjects, project.id])]
                          : selectedProjects.filter((id) => id !== project.id), { shouldValidate: true })} />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        <span className="text-xs text-muted-foreground">{project.code}</span>
                      </label>
                    );
                  })}
                </div>
                <FieldMessage error={fieldError('projectIds')} hint="移出项目后，该用户在该项目名下的客户会转为未分配" />
              </fieldset>
            ) : null}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="user-form" loading={submitting}>
            {isEdit ? '保存修改' : '创建用户'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
