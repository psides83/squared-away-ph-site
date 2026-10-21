begin;

-- Save the profile and relationships in one transaction. A failed relationship
-- must never leave a new horse without a customer, or partially update a profile.
create function public.save_horse_with_customers(
  p_horse jsonb,
  p_customer_ids uuid[],
  p_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
  v_horse public.horses%rowtype;
  v_customers uuid[];
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_customer_ids is null or cardinality(p_customer_ids) = 0
     or cardinality(p_customer_ids) > 100
     or array_position(p_customer_ids, null) is not null then
    raise exception 'Select at least one valid customer' using errcode = '23514';
  end if;
  select array_agg(distinct customer_id) into v_customers
    from unnest(p_customer_ids) as selected(customer_id);
  if (select count(*) from public.customers where id = any(v_customers)) <> cardinality(v_customers) then
    raise exception 'Selected customer does not exist' using errcode = '23503';
  end if;

  v_horse := jsonb_populate_record(null::public.horses, p_horse);
  if p_id is null then
    insert into public.horses (
      barn_name, registered_name, registration_number, birth_year, sex,
      breed, training_goals, feeding_instructions, health_notes
    ) values (
      v_horse.barn_name, v_horse.registered_name, v_horse.registration_number,
      v_horse.birth_year, coalesce(v_horse.sex, 'unknown'), v_horse.breed,
      v_horse.training_goals, v_horse.feeding_instructions, v_horse.health_notes
    ) returning id into v_id;
  else
    update public.horses set
      barn_name = v_horse.barn_name,
      registered_name = v_horse.registered_name,
      registration_number = v_horse.registration_number,
      birth_year = v_horse.birth_year,
      sex = coalesce(v_horse.sex, 'unknown'),
      breed = v_horse.breed,
      training_goals = v_horse.training_goals,
      feeding_instructions = v_horse.feeding_instructions,
      health_notes = v_horse.health_notes
    where id = p_id returning id into v_id;
    if not found then
      raise exception 'Horse not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.horse_customers
    where horse_id = v_id and not (customer_id = any(v_customers));
  insert into public.horse_customers(horse_id, customer_id)
    select v_id, customer_id from unnest(v_customers) as selected(customer_id)
    on conflict (horse_id, customer_id) do nothing;
  return v_id;
end;
$$;

revoke all on function public.save_horse_with_customers(jsonb, uuid[], uuid) from public;
grant execute on function public.save_horse_with_customers(jsonb, uuid[], uuid) to authenticated;

commit;
