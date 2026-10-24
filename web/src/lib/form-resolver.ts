import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * zodResolver 的薄封装。
 * ------------------------------------------------------------------
 * @hookform/resolvers v5 的 zodResolver 会按 schema 的「输入类型 → 输出类型」推断
 * Resolver 泛型；像报价单、用户表单这类带 coerce / default / transform 的 schema，
 * 输入类型和输出类型本来就不同，直接塞进 useForm<T> 会报「两个同名类型不相关」。
 * 这里统一按表单值类型返回 Resolver：运行时校验完全一样，只是把泛型对齐，
 * 免得到处写 as unknown as。
 */
export function formResolver<TValues extends FieldValues>(schema: ZodType): Resolver<TValues> {
  return zodResolver(schema as never) as unknown as Resolver<TValues>;
}
