-- XOS — put salespeople in the Salespeople directory group. The DJEP import set
-- staff_category from Administrator access only (everyone else → Production), so
-- salesperson-tier staff (Isabella, Naqeeb, Stephanie) landed under Production
-- and the Salespeople group showed empty. Align category with their access tier.
-- Master admins / owners (e.g. Laura) keep their Administrators category.
update employees
set staff_category = 'Salespeople'
where permission_tier = 'salesperson'
  and staff_category is distinct from 'Salespeople';
